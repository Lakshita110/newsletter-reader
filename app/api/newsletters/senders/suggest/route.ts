import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/session-user";
import { getGmailAccessToken } from "@/lib/gmail-token";
import { suggestNewsletterSenders } from "@/lib/newsletter-sync";

export const dynamic = "force-dynamic";

/** Newsletter-looking senders across all connected mailboxes that aren't on the list yet. */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accounts = await prisma.gmailAccount.findMany({ where: { userId }, select: { id: true } });
  const tokens = (await Promise.all(accounts.map((a) => getGmailAccessToken(a.id)))).filter((t): t is string =>
    Boolean(t)
  );
  if (tokens.length === 0) return NextResponse.json({ error: "No Gmail account connected" }, { status: 401 });
  const [suggestions, current] = await Promise.all([
    suggestNewsletterSenders(tokens),
    prisma.newsletterSender.findMany({ where: { userId, isActive: true }, select: { email: true } }),
  ]);
  const have = new Set(current.map((s) => s.email));
  return NextResponse.json(suggestions.filter((s) => !have.has(s.email)).slice(0, 25));
}
