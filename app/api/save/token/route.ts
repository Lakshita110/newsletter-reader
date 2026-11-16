import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session-user";
import { getOrCreateSaveToken } from "@/lib/saved-articles";

export const dynamic = "force-dynamic";

/** GET returns your save token (creating one); POST rotates it, breaking old bookmarklets/shortcuts. */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ token: await getOrCreateSaveToken(userId) });
}

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ token: await getOrCreateSaveToken(userId, true) });
}
