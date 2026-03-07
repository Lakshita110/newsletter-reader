import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncRssSource } from "@/lib/rss";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
    select: { id: true },
  });

  const body = await req.json().catch(() => ({}));
  const sourceIds = Array.isArray(body?.sourceIds)
    ? body.sourceIds.filter((id: unknown): id is string => typeof id === "string")
    : [];

  const subscriptions = await prisma.userRssSubscription.findMany({
    where: {
      userId: user.id,
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
