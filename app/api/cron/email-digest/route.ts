import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import {
  buildEmailHtml,
  getCurrentHourInTimezone,
  getDigestSubject,
  getLocalDateKey,
} from "@/lib/email-digest";

export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const configured = process.env.CRON_SECRET;
  if (!configured) return false;
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return bearer === configured || (req.headers.get("x-cron-secret") ?? "") === configured;
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
        subject: getDigestSubject(emailItems.length),
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
