import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session-user";
import { removeGmailAccount } from "@/lib/gmail-token";

export const dynamic = "force-dynamic";

/** Stop reading a mailbox. Issues already stored from it stay. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const removed = await removeGmailAccount(userId, id);
  return removed ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
