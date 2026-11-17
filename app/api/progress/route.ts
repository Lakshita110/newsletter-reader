import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/session-user";

export const dynamic = "force-dynamic";

/**
 * Reading position for "pick up where you left off". Stored in the existing
 * MessageReadStat.maxScrollPct (furthest point reached), so no migration:
 * resuming at the furthest point is what you want after closing the app
 * mid-article.
 */
export async function GET(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const messageId = new URL(req.url).searchParams.get("id");
  if (!messageId) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const row = await prisma.messageReadStat.findUnique({
    where: { userId_messageExternalId: { userId, messageExternalId: messageId } },
    select: { maxScrollPct: true, completedAt: true },
  });
  return NextResponse.json({
    scrollPct: row?.maxScrollPct ?? 0,
    completed: Boolean(row?.completedAt),
  });
}

/** Body: { messageId, scrollPct (0-100), secondsDelta } — sent every few seconds while reading. */
export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const messageId = typeof body?.messageId === "string" ? body.messageId : "";
  const scrollPct = Number(body?.scrollPct);
  const secondsDelta = Number(body?.secondsDelta);
  if (!messageId || !Number.isFinite(scrollPct)) {
    return NextResponse.json({ error: "Missing messageId or scrollPct" }, { status: 400 });
  }
  const pct = Math.max(0, Math.min(100, scrollPct));
  // Cap the delta so a backgrounded tab can't book hours of "reading".
  const seconds = Number.isFinite(secondsDelta) ? Math.max(0, Math.min(60, Math.round(secondsDelta))) : 0;
  const where = { userId_messageExternalId: { userId, messageExternalId: messageId } };

  const existing = await prisma.messageReadStat.findUnique({ where, select: { maxScrollPct: true } });
  if (!existing) {
    // The reader marks the item in_progress on open, so this is rare (e.g. a
    // race on first load); create rather than drop the position.
    await prisma.messageReadStat.create({
      data: {
        userId,
        messageExternalId: messageId,
        maxScrollPct: pct,
        totalSecondsRead: seconds,
        firstOpenedAt: new Date(),
        lastOpenedAt: new Date(),
        openCount: 1,
      },
    });
  } else {
    await prisma.messageReadStat.update({
      where,
      data: {
        maxScrollPct: Math.max(existing.maxScrollPct, pct),
        totalSecondsRead: { increment: seconds },
        lastOpenedAt: new Date(),
      },
    });
  }
  return NextResponse.json({ ok: true });
}
