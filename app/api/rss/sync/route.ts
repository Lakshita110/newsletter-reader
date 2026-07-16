import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncRssSource } from "@/lib/rss";
import { getSessionUserId } from "@/lib/session-user";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const sourceIds = Array.isArray(body?.sourceIds)
    ? body.sourceIds.filter((id: unknown): id is string => typeof id === "string")
    : [];

  const subscriptions = await prisma.userRssSubscription.findMany({
    where: {
      userId,
      isActive: true,
      ...(sourceIds.length > 0 ? { rssSourceId: { in: sourceIds } } : {}),
    },
    select: { rssSourceId: true },
  });

  let inserted = 0;
  let updated = 0;
  const newItemIds: string[] = [];
  const errors: string[] = [];

  for (const sub of subscriptions) {
    try {
      const result = await syncRssSource(sub.rssSourceId);
      inserted += result.inserted;
      updated += result.updated;
      if (Array.isArray(result.insertedItemIds) && result.insertedItemIds.length > 0) {
        for (const id of result.insertedItemIds) newItemIds.push(`rss:${id}`);
      }
    } catch (error) {
      errors.push(`${sub.rssSourceId}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  return NextResponse.json({
    ok: true,
    sourceCount: subscriptions.length,
    inserted,
    updated,
    newItemIds,
    errors,
  });
}
