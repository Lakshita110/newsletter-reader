import { prisma } from "@/lib/prisma";

type SourceEngagement = {
  sourceId: string;
  opens: number;
  completions: number;
  avgCompletionPct: number;
  lastOpenedAt: Date | null;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function recencyScore(lastOpenedAt: Date | null): number {
  if (!lastOpenedAt) return 0;
  const ageDays = (Date.now() - lastOpenedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= 3) return 1;
  if (ageDays <= 7) return 0.75;
  if (ageDays <= 14) return 0.5;
  if (ageDays <= 30) return 0.25;
  return 0.1;
}

function scoreSource(source: SourceEngagement): number {
  const completionRate = source.opens > 0 ? source.completions / source.opens : 0;
  const avgCompletion = source.avgCompletionPct / 100;
  const confidence = clamp(source.opens / 12, 0.2, 1);
  const recency = recencyScore(source.lastOpenedAt);

  // Favor sources the user reliably completes and has read recently.
  return (completionRate * 0.55 + avgCompletion * 0.25 + recency * 0.2) * confidence;
}

async function getSourceEngagement(userId: string): Promise<SourceEngagement[]> {
  const readRows = await prisma.messageReadStat.findMany({
    where: {
      userId,
      messageExternalId: { startsWith: "rss:" },
    },
    select: {
      messageExternalId: true,
      completionPct: true,
      completedAt: true,
      lastOpenedAt: true,
    },
    orderBy: { lastOpenedAt: "desc" },
    take: 1200,
  });

  if (readRows.length < 20) return [];

  const itemIds = readRows
    .map((row) => row.messageExternalId.replace(/^rss:/, ""))
    .filter((id) => id.length > 0);

  if (itemIds.length === 0) return [];

  const rssItems = await prisma.rssItem.findMany({
    where: {
      id: { in: itemIds },
    },
    select: {
      id: true,
      rssSourceId: true,
    },
  });

  const sourceByItemId = new Map(rssItems.map((item) => [item.id, item.rssSourceId]));
  const stats = new Map<string, SourceEngagement>();

  for (const row of readRows) {
    const itemId = row.messageExternalId.replace(/^rss:/, "");
    const sourceId = sourceByItemId.get(itemId);
    if (!sourceId) continue;

    const existing =
      stats.get(sourceId) ?? {
        sourceId,
        opens: 0,
        completions: 0,
        avgCompletionPct: 0,
        lastOpenedAt: null,
      };

    existing.opens += 1;
    if (row.completedAt || row.completionPct >= 99) existing.completions += 1;
    existing.avgCompletionPct += row.completionPct;

    const opened = row.lastOpenedAt ?? null;
    if (opened && (!existing.lastOpenedAt || opened > existing.lastOpenedAt)) {
      existing.lastOpenedAt = opened;
    }

    stats.set(sourceId, existing);
  }

  const result = [...stats.values()]
    .filter((source) => source.opens >= 3)
    .map((source) => ({
      ...source,
      avgCompletionPct: Math.round(source.avgCompletionPct / source.opens),
    }));

  return result.length >= 3 ? result : [];
}

export async function reprioritizeUserRssSubscriptions(userId: string): Promise<{
  updatedSources: number;
  skipped: boolean;
}> {
  const engagement = await getSourceEngagement(userId);
  if (engagement.length === 0) return { updatedSources: 0, skipped: true };

  const ranked = engagement
    .map((source) => ({
      ...source,
      score: scoreSource(source),
    }))
    .sort((a, b) => b.score - a.score);

  const topCut = Math.max(1, Math.ceil(ranked.length * 0.3));
  const lowCutStart = Math.floor(ranked.length * 0.7);

  const updates = ranked.map((source, idx) => {
    const priority = idx < topCut ? "HIGH" : idx >= lowCutStart ? "LOW" : "NORMAL";
    const dailyCap = priority === "HIGH" ? 4 : priority === "NORMAL" ? 2 : 1;

    return prisma.userRssSubscription.updateMany({
      where: {
        userId,
        rssSourceId: source.sourceId,
        isActive: true,
      },
      data: {
        priority,
        dailyCap,
      },
    });
  });

  await prisma.$transaction(updates);

  return {
    updatedSources: updates.length,
    skipped: false,
  };
}
