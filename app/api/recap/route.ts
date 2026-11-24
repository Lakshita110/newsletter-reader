import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session-user";
import { loadRecap } from "@/lib/recap";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await loadRecap(userId));
}
