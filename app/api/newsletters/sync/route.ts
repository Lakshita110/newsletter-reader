import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session-user";
import { syncNewsletters } from "@/lib/newsletter-sync";
import { getGmailAccessToken } from "@/lib/gmail-token";

export const dynamic = "force-dynamic";

/** Manual "sync now" — bypasses the 2-minute throttle and allows a longer budget. */
export async function POST() {
  const auth = await getSessionUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await syncNewsletters(auth.userId, (await getGmailAccessToken(auth.userId)) ?? undefined, { force: true, timeBudgetMs: 20000 });
  return NextResponse.json(result);
}
