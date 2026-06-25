import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { dayKeyUtc } from "@/lib/rss-helpers";

export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const configured = process.env.CRON_SECRET;
  if (!configured) return false;
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return bearer === configured || (req.headers.get("x-cron-secret") ?? "") === configured;
}

function getCurrentHourInTimezone(tz: string): number {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false });
    const parts = formatter.formatToParts(new Date());
    const hourStr = parts.find((p) => p.type === "hour")?.value;
    return hourStr ? parseInt(hourStr, 10) % 24 : -1;
  } catch {
    return -1;
  }
}

function getLocalDateKey(tz: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    return formatter.format(new Date());
  } catch {
    return dayKeyUtc(new Date());
  }
}

function buildEmailHtml(items: Array<{ title: string; sourceName: string; snippet: string; externalUrl: string | null }>): string {
  const rows = items
    .map(
      (item) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;">
        <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:4px;">
          ${item.externalUrl
            ? `<a href="${item.externalUrl}" style="color:#111827;text-decoration:none;">${item.title}</a>`
            : item.title}
        </div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">${item.sourceName}</div>
        ${item.snippet ? `<div style="font-size:13px;color:#374151;line-height:1.5;">${item.snippet.slice(0, 160).trim()}…</div>` : ""}
      </td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;padding:24px;">
        <tr><td style="padding-bottom:20px;border-bottom:1px solid #e5e7eb;">
          <div style="font-size:18px;font-weight:700;color:#111827;">Your daily reading list</div>
          <div style="font-size:13px;color:#6b7280;margin-top:4px;">${new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}</div>
        </td></tr>
        <tr><td>
          <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
        </td></tr>
        <tr><td style="padding-top:20px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
          Manage your digest preferences in <a href="${process.env.NEXT_PUBLIC_APP_URL ?? ""}/rss/settings/recommendations" style="color:#6b7280;">RSS settings</a>.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const transporter = createTransporter();
  if (!transporter) {
    return NextResponse.json({ error: "GMAIL_USER and GMAIL_APP_PASSWORD must be set" }, { status: 503 });
  }

  const url = new URL(req.url);
  // ?force=true skips the hour check and duplicate-send guard — for testing only
  const force = url.searchParams.get("force") === "true";

  const fromEmail = process.env.GMAIL_USER!;
  const digestHour = Number(process.env.DIGEST_HOUR ?? 7);

  const eligibleUsers = await prisma.user.findMany({
    where: { digestEnabled: true },
    select: {
      id: true,
      email: true,
      digestTimezone: true,
      digestLastSentAt: true,
    },
  });

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const user of eligibleUsers) {
    try {
      const tz = user.digestTimezone || "UTC";

      if (!force) {
        const localHour = getCurrentHourInTimezone(tz);
        if (localHour !== digestHour) { skipped += 1; continue; }

        const localDateKey = getLocalDateKey(tz);
        if (user.digestLastSentAt) {
          const lastSentLocalKey = new Intl.DateTimeFormat("en-CA", { timeZone: tz })
            .format(user.digestLastSentAt);
          if (lastSentLocalKey === localDateKey) { skipped += 1; continue; }
        }
      }

      const localDateKey = getLocalDateKey(tz);
      const snapshot = await prisma.userRssDailyRankSnapshot.findFirst({
        where: { userId: user.id, dayKey: localDateKey },
        select: { rankedItemIds: true },
      });

      const rankedIds = Array.isArray(snapshot?.rankedItemIds)
        ? (snapshot.rankedItemIds as string[]).filter((id): id is string => typeof id === "string").slice(0, 10)
        : [];

      if (rankedIds.length === 0) { skipped += 1; continue; }

      const rssItemIds = rankedIds
        .filter((id) => id.startsWith("rss:"))
        .map((id) => id.slice(4));

      const dbItems = await prisma.rssItem.findMany({
        where: { id: { in: rssItemIds } },
        select: {
          id: true,
          title: true,
          snippet: true,
          link: true,
          source: { select: { name: true } },
        },
      });

      const byId = new Map(dbItems.map((item) => [item.id, item]));
      const emailItems = rankedIds
        .filter((id) => id.startsWith("rss:"))
        .map((id) => byId.get(id.slice(4)))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .map((item) => ({
          title: item.title,
          sourceName: item.source.name,
          snippet: item.snippet ?? "",
          externalUrl: item.link ?? null,
        }));

      if (emailItems.length === 0) { skipped += 1; continue; }

      await transporter.sendMail({
        from: `Cluck's Feed <${fromEmail}>`,
        to: user.email,
        subject: `Your daily reading list — ${emailItems.length} articles`,
        html: buildEmailHtml(emailItems),
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { digestLastSentAt: new Date() },
      });

      sent += 1;
    } catch (err) {
      const msg = `${user.email}: ${err instanceof Error ? err.message : "unknown"}`;
      errors.push(msg);
      console.error("[email-digest] failed", msg);
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, errors });
}

export async function POST(req: Request) {
  return GET(req);
}
