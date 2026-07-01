import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { buildEmailHtml, getDigestSubject, getLocalDateKey } from "@/lib/email-digest";

export type DigestUser = {
  id: string;
  email: string;
  digestTimezone: string;
  digestLastSentAt: Date | null;
};

export type DigestSendResult =
  | { status: "sent"; itemCount: number }
  | { status: "skipped"; reason: "already_sent_today" | "no_ranked_items" }
  | { status: "error"; message: string };

export function createDigestTransporter(): nodemailer.Transporter | null {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

/**
 * Builds and sends one user's daily digest, if there's anything to send.
 * `force` skips the "already sent today" de-dupe guard (used by manual test
 * sends) but never skips the "nothing ranked yet" check — there's nothing to
 * email either way.
 */
export async function sendDigestForUser(params: {
  transporter: nodemailer.Transporter;
  fromEmail: string;
  user: DigestUser;
  force?: boolean;
}): Promise<DigestSendResult> {
  const { transporter, fromEmail, user, force = false } = params;
  const tz = user.digestTimezone || "UTC";

  try {
    const localDateKey = getLocalDateKey(tz);

    if (!force && user.digestLastSentAt) {
      const lastSentLocalKey = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(
        user.digestLastSentAt
      );
      if (lastSentLocalKey === localDateKey) {
        return { status: "skipped", reason: "already_sent_today" };
      }
    }

    const snapshot = await prisma.userRssDailyRankSnapshot.findFirst({
      where: { userId: user.id, dayKey: localDateKey },
      select: { rankedItemIds: true },
    });

    const rankedIds = Array.isArray(snapshot?.rankedItemIds)
      ? (snapshot.rankedItemIds as string[]).filter((id): id is string => typeof id === "string").slice(0, 10)
      : [];
    if (rankedIds.length === 0) {
      return { status: "skipped", reason: "no_ranked_items" };
    }

    const rssItemIds = rankedIds.filter((id) => id.startsWith("rss:")).map((id) => id.slice(4));
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

    if (emailItems.length === 0) {
      return { status: "skipped", reason: "no_ranked_items" };
    }

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

    return { status: "sent", itemCount: emailItems.length };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "unknown error" };
  }
}
