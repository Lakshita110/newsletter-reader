import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type ReadStateUpdate = "in_progress" | "read" | "unread";

export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
    select: { id: true },
  });

  const rows = await prisma.messageReadStat.findMany({
    where: { userId: user.id },
    select: {
      messageExternalId: true,
      completedAt: true,
      completionPct: true,
    },
  });

  const readIds: string[] = [];
  const inProgressIds: string[] = [];
  for (const row of rows) {
    if (row.completedAt || row.completionPct >= 99) readIds.push(row.messageExternalId);
    else inProgressIds.push(row.messageExternalId);
  }

  return NextResponse.json({
    readIds,
    inProgressIds,
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const messageId = typeof body?.messageId === "string" ? body.messageId : "";
  const messageIds = Array.isArray(body?.messageIds)
    ? body.messageIds.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
    : [];
  const state: ReadStateUpdate =
    body?.state === "read" || body?.state === "unread" ? body.state : "in_progress";
  const targets = messageIds.length > 0 ? messageIds : messageId ? [messageId] : [];
  if (targets.length === 0) {
    return NextResponse.json({ error: "Missing messageId(s)" }, { status: 400 });
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
    select: { id: true },
  });

  const now = new Date();

  for (const targetId of targets) {
    const where = {
      userId_messageExternalId: {
        userId: user.id,
        messageExternalId: targetId,
      },
    };

    if (state === "unread") {
      await prisma.messageReadStat.deleteMany({
        where: {
          userId: user.id,
          messageExternalId: targetId,
        },
      });
      continue;
    }

    const existing = await prisma.messageReadStat.findUnique({ where });
    if (state === "read") {
      await prisma.messageReadStat.upsert({
        where,
        update: {
          lastOpenedAt: now,
          openCount: { increment: 1 },
          completionPct: 100,
          maxScrollPct: 100,
          completedAt: now,
        },
        create: {
          userId: user.id,
          messageExternalId: targetId,
          firstOpenedAt: now,
          lastOpenedAt: now,
          openCount: 1,
          completionPct: 100,
          maxScrollPct: 100,
          completedAt: now,
        },
      });
      continue;
    }

    if (!existing) {
      await prisma.messageReadStat.create({
        data: {
          userId: user.id,
          messageExternalId: targetId,
          firstOpenedAt: now,
          lastOpenedAt: now,
          openCount: 1,
          completionPct: 50,
        },
      });
    } else {
      await prisma.messageReadStat.update({
        where,
        data: {
          lastOpenedAt: now,
          openCount: { increment: 1 },
          completionPct: existing.completedAt ? existing.completionPct : 50,
        },
      });
    }
  }

  return NextResponse.json({ ok: true, count: targets.length });
}
