import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session-user";
import { getGmailStatus } from "@/lib/gmail-token";

export const dynamic = "force-dynamic";

/** Whether new newsletters can be pulled from Gmail; drives the "Reconnect Gmail" banner. */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getGmailStatus(userId));
}
