import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session-user";
import { getOrCreateSummary, SummaryError } from "@/lib/summarize";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const itemId = typeof body?.itemId === "string" ? body.itemId : "";
  if (!itemId) return NextResponse.json({ error: "Missing itemId" }, { status: 400 });
  try {
    return NextResponse.json(await getOrCreateSummary(userId, itemId));
  } catch (error) {
    const status = error instanceof SummaryError ? error.status : 500;
    if (status === 500) console.error("[summarize] failed", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
