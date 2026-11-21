import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session-user";
import { syncAllMailboxes } from "@/lib/newsletter-sync";

export const dynamic = "force-dynamic";

/** Manual "sync now" for every mailbox: bypasses the 2-minute throttle and allows a longer budget. */
export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const results = await syncAllMailboxes(userId, { force: true, timeBudgetMs: 20000 });
  return NextResponse.json({ added: results.reduce((sum, r) => sum + r.added, 0), mailboxes: results });
}
