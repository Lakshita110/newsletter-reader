import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/session-user";

export const dynamic = "force-dynamic";

/**
 * "opened" is what the reader sends when an item is opened: it records the
 * visit but never un-finishes a finished item. "in_progress" is an explicit
 * reset (Undo uses it) and does clear completedAt. Opening used to send
 * in_progress, so re-opening a done item, or a slow "opened" request landing
 * after a quick "done", silently put the item back in Today.
 *
 * "dismissed" is a swipe (or Done, or Mark all read) on Today: the item is
 * finished, so it leaves the list, but it is not recorded as a read. Before,
 * Today sent "read", which set a visit and 100% completion, so everything she
 * swiped away unread taught the ranker she liked it. See lib/reading-signals.
 */
type ReadStateUpdate = "in_progress" | "opened" | "read" | "dismissed" | "unread" | "saved" | "unsaved";
const READ_STATE_UPDATES = new Set<string>([
  "in_progress",
  "opened",
  "read",
  "dismissed",
  "unread",
  "saved",
  "unsaved",
]);
type SourceKind = "gmail" | "rss" | "web";

type ReadStateMetadata = {
  title?: string;
  sourceKind?: SourceKind;
  publicationName?: string;
};

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toSourceKind(value: unknown): SourceKind | undefined {
  return value === "gmail" || value === "rss" || value === "web" ? value : undefined;
}

function normalizeMetadata(value: unknown): ReadStateMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const title = toOptionalString(record.title);
  const sourceKind = toSourceKind(record.sourceKind);
  const publicationName = toOptionalString(record.publicationName);
  if (!title && !sourceKind && !publicationName) return undefined;
  return { title, sourceKind, publicationName };
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.messageReadStat.findMany({
    where: { userId },
    select: {
      messageExternalId: true,
      completedAt: true,
      completionPct: true,
      savedAt: true,
      firstOpenedAt: true,
      lastOpenedAt: true,
      openCount: true,
    },
  });

  const readIds: string[] = [];
  const inProgressIds: string[] = [];
  const savedIds: string[] = [];
  for (const row of rows) {
    const isRead = Boolean(row.completedAt) || row.completionPct >= 99;
    const isInProgress =
      !isRead &&
      (row.completionPct > 0 || row.openCount > 0 || Boolean(row.firstOpenedAt) || Boolean(row.lastOpenedAt));
    if (isRead) readIds.push(row.messageExternalId);
    else if (isInProgress) inProgressIds.push(row.messageExternalId);
    if (row.savedAt) savedIds.push(row.messageExternalId);
  }

  return NextResponse.json({
    readIds,
    inProgressIds,
    savedIds,
  });
}

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const messageId = typeof body?.messageId === "string" ? body.messageId : "";
  const messageIds = Array.isArray(body?.messageIds)
    ? body.messageIds.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
    : [];
  // An unknown state is a client bug: reject it rather than guessing.
  if (!READ_STATE_UPDATES.has(body?.state)) {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  }
  const state = body.state as ReadStateUpdate;
  const singleMetadata =
    normalizeMetadata(body?.metadata) ??
    normalizeMetadata({
      title: body?.title,
      sourceKind: body?.sourceKind,
      publicationName: body?.publicationName,
    });
  const contextById =
    body?.contextById && typeof body.contextById === "object" && !Array.isArray(body.contextById)
      ? (body.contextById as Record<string, unknown>)
      : {};
  const targets = messageIds.length > 0 ? messageIds : messageId ? [messageId] : [];
  if (targets.length === 0) {
    return NextResponse.json({ error: "Missing messageId(s)" }, { status: 400 });
  }

  const now = new Date();

  for (const targetId of targets) {
    const metadata = normalizeMetadata(contextById[targetId]) ?? singleMetadata;
    const metadataFields = metadata
      ? {
          ...(metadata.title ? { messageTitle: metadata.title } : {}),
          ...(metadata.sourceKind ? { sourceKind: metadata.sourceKind } : {}),
          ...(metadata.publicationName ? { publicationName: metadata.publicationName } : {}),
        }
      : {};
    const where = {
      userId_messageExternalId: {
        userId,
        messageExternalId: targetId,
      },
    };

    const existing = await prisma.messageReadStat.findUnique({
      where,
      select: {
        id: true,
        savedAt: true,
        completedAt: true,
        completionPct: true,
        firstOpenedAt: true,
        lastOpenedAt: true,
        openCount: true,
      },
    });

    if (state === "read") {
      await prisma.messageReadStat.upsert({
        where,
        update: {
          lastOpenedAt: now,
          openCount: { increment: 1 },
          completionPct: 100,
          maxScrollPct: 100,
          completedAt: now,
          ...metadataFields,
        },
        create: {
          userId,
          messageExternalId: targetId,
          firstOpenedAt: now,
          lastOpenedAt: now,
          openCount: 1,
          completionPct: 100,
          maxScrollPct: 100,
          completedAt: now,
          ...metadataFields,
        },
      });
      continue;
    }

    if (state === "dismissed") {
      // Finish it without touching the visit or completion fields: those are
      // what say whether she actually read it.
      await prisma.messageReadStat.upsert({
        where,
        update: { completedAt: now, ...metadataFields },
        create: { userId, messageExternalId: targetId, completedAt: now, ...metadataFields },
      });
      continue;
    }

    if (state === "saved") {
      await prisma.messageReadStat.upsert({
        where,
        update: {
          savedAt: now,
          ...metadataFields,
        },
        create: {
          userId,
          messageExternalId: targetId,
          savedAt: now,
          ...metadataFields,
        },
      });
      continue;
    }

    if (state === "unread") {
      if (!existing) continue;
      if (existing.savedAt) {
        await prisma.messageReadStat.update({
          where,
          data: {
            firstOpenedAt: null,
            lastOpenedAt: null,
            openCount: 0,
            totalSecondsRead: 0,
            maxScrollPct: 0,
            completionPct: 0,
            completedAt: null,
          },
        });
      } else {
        await prisma.messageReadStat.delete({
          where,
        });
      }
      continue;
    }

    if (state === "opened") {
      await prisma.messageReadStat.upsert({
        where,
        update: { lastOpenedAt: now, openCount: { increment: 1 }, ...metadataFields },
        create: {
          userId,
          messageExternalId: targetId,
          firstOpenedAt: now,
          lastOpenedAt: now,
          openCount: 1,
          completionPct: 50,
          ...metadataFields,
        },
      });
      continue;
    }

    if (state === "unsaved") {
      if (!existing) continue;
      const hasReadState =
        Boolean(existing.completedAt) ||
        existing.completionPct > 0 ||
        existing.openCount > 0 ||
        Boolean(existing.firstOpenedAt) ||
        Boolean(existing.lastOpenedAt);
      if (hasReadState) {
        await prisma.messageReadStat.update({
          where,
          data: { savedAt: null },
        });
      } else {
        await prisma.messageReadStat.delete({
          where,
        });
      }
      continue;
    }

    await prisma.messageReadStat.upsert({
      where,
      update: {
        lastOpenedAt: now,
        openCount: { increment: 1 },
        completionPct: {
          set: 50,
        },
        completedAt: null,
        ...metadataFields,
      },
      create: {
        userId,
        messageExternalId: targetId,
        firstOpenedAt: now,
        lastOpenedAt: now,
        openCount: 1,
        completionPct: 50,
        ...metadataFields,
      },
    });
  }

  return NextResponse.json({ ok: true, count: targets.length });
}
