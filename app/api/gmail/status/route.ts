import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session-user";
import { listGmailAccounts } from "@/lib/gmail-token";

export const dynamic = "force-dynamic";

/** Every mailbox newsletters are read from, and whether each still has access. */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ accounts: await listGmailAccounts(userId) });
}
