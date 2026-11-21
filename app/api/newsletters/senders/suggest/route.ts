import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/session-user";
import { getGmailAccessToken } from "@/lib/gmail-token";
import { isPlatformSender } from "@/lib/newsletter-sync-helpers";
import { storedSenderSuggestions, suggestNewsletterSenders } from "@/lib/newsletter-sync";

export const dynamic = "force-dynamic";

type Suggestion = { email: string; name: string; count: number; lastSubject: string };

/**
 * Newsletter-looking senders that aren't approved yet: first those with
 * issues already stored, then ones seen in the last 30 days of every
 * connected mailbox. Platform senders are left out because they're always
 * pulled.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accounts = await prisma.gmailAccount.findMany({ where: { userId }, select: { id: true } });
  const tokens = (await Promise.all(accounts.map((a) => getGmailAccessToken(a.id)))).filter((t): t is string =>
    Boolean(t)
  );
  const [stored, scanned, current] = await Promise.all([
    storedSenderSuggestions(userId),
    tokens.length > 0 ? suggestNewsletterSenders(tokens) : Promise.resolve([] as Suggestion[]),
    prisma.newsletterSender.findMany({ where: { userId, isActive: true }, select: { email: true } }),
  ]);
  const seen = new Set(current.map((s) => s.email));
  const merged: Suggestion[] = [];
  for (const s of [...stored, ...scanned]) {
    if (seen.has(s.email) || isPlatformSender(s.email)) continue;
    seen.add(s.email);
    merged.push(s);
  }
  return NextResponse.json(merged.slice(0, 30));
}
