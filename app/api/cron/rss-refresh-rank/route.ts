import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncRssSource } from "@/lib/rss";
import { rankItemsForDailyCap } from "@/lib/rss-daily-cap-ranker";

type RssPriority = "HIGH" | "NORMAL" | "LOW";

type Candidate = {
  id: string;
  sourceId: string;
  sourceName: string;
  priority: RssPriority;
  sortTimeMs: number;
  title: string;
  snippet: string;
  author: string | null;
  publishedAtIso: string;
};

const FALLBACK_SNAPSHOT_TTL_MS = 45 * 60 * 1000;

function isAuthorized(req: Request): boolean {
  const configured = process.env.CRON_SECRET;
  if (!configured) return false;
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const header = req.headers.get("x-cron-secret") ?? "";
  return bearer === configured || header === configured;
}

function dayKeyUtc(value: Date | null): string {
  if (!value) return "unknown";
  const y = value.getUTCFullYear();
  const m = `${value.getUTCMonth() + 1}`.padStart(2, "0");
  const d = `${value.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function priorityScore(priority: RssPriority): number {
  if (priority === "HIGH") return 3;
  if (priority === "NORMAL") return 2;
  return 1;
}

function rankSnapshotExpiryUtc(dayKey: string): Date {
  const nextDay = new Date(`${dayKey}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return nextDay;
}

function buildRankInputFingerprint(dayKey: string, cap: number, items: Array<{ id: string }>): string {
  const payload = `${dayKey}|${cap}|${items.map((item) => item.id).join(",")}`;
  return createHash("sha256").update(payload).digest("hex");
}

async function getUserRssReadProfile(userId: string) {
  const rows = await prisma.messageReadStat.findMany({
    where: {
      userId,
      OR: [{ sourceKind: "rss" }, { messageExternalId: { startsWith: "rss:" } }],
    },
    select: {
      publicationName: true,
      completionPct: true,
      openCount: true,
      lastOpenedAt: true,
    },
    orderBy: { lastOpenedAt: "desc" },
    take: 600,
  });

  if (rows.length === 0) {
    return {
      topPublications: [],
      avgCompletionPct: 0,
      recentReadCount7d: 0,
      preferenceSummary: [],
    };
  }

  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  let completionTotal = 0;
  let recentReadCount7d = 0;
  const publicationScores = new Map<string, number>();

  for (const row of rows) {
    const completion = Number.isFinite(row.completionPct) ? row.completionPct : 0;
    completionTotal += completion;
    if (row.lastOpenedAt && now - row.lastOpenedAt.getTime() <= sevenDaysMs) {
      recentReadCount7d += 1;
    }
    const publication = row.publicationName?.trim();
    if (!publication) continue;
    const openCount = Math.max(1, row.openCount || 1);
    const score = completion / 100 + Math.min(3, openCount * 0.35);
    publicationScores.set(publication, (publicationScores.get(publication) ?? 0) + score);
  }

  const topPublications = [...publicationScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, score]) => ({ name, score }));

  const avgCompletionPct = completionTotal / rows.length;
  const preferenceSummary: string[] = [];
  if (topPublications.length > 0) {
    preferenceSummary.push(
      `Frequently read publications: ${topPublications
        .slice(0, 5)
        .map((p) => p.name)
        .join(", ")}`
    );
  }
  preferenceSummary.push(`Average completion is ${avgCompletionPct.toFixed(0)}%`);
  preferenceSummary.push(`Read activity in last 7 days: ${recentReadCount7d} opened items`);

  return {
    topPublications,
    avgCompletionPct,
    recentReadCount7d,
    preferenceSummary,
  };
}

async function refreshTodaySnapshotForUser(userId: string, dayKey: string) {
  const subscriptions = await prisma.userRssSubscription.findMany({
    where: { userId, isActive: true },
    include: {
      source: {
        include: {
          items: {
            orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
            take: 300,
          },
        },
      },
    },
  });

  const candidates: Candidate[] = [];
  let totalCap = 0;
  for (const sub of subscriptions) {
    if (sub.dailyCap > 0) totalCap += sub.dailyCap;
    for (const item of sub.source.items) {
      if (dayKeyUtc(item.publishedAt ?? item.createdAt) !== dayKey) continue;
      candidates.push({
        id: `rss:${item.id}`,
        sourceId: sub.source.id,
        sourceName: sub.source.name,
        priority: sub.priority,
        sortTimeMs: item.publishedAt?.getTime() ?? item.createdAt.getTime(),
        title: item.title,
        snippet: item.snippet ?? "",
        author: item.author ?? null,
        publishedAtIso: (item.publishedAt ?? item.createdAt).toISOString(),
      });
    }
  }

  const sortedFallback = candidates.sort((a, b) => {
    const pa = priorityScore(a.priority);
    const pb = priorityScore(b.priority);
    if (pa !== pb) return pb - pa;
    return b.sortTimeMs - a.sortTimeMs;
  });

  const deterministicIds =
    totalCap <= 0
      ? []
      : sortedFallback.slice(0, totalCap).map((candidate) => candidate.id);
  const aiItems = sortedFallback.map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    snippet: candidate.snippet,
    author: candidate.author,
    publishedAtIso: candidate.publishedAtIso,
  }));
  const inputFingerprint = buildRankInputFingerprint(dayKey, totalCap, aiItems);

  let rankedIds = deterministicIds;
  let status: "AI_SUCCESS" | "FALLBACK_DETERMINISTIC" = "FALLBACK_DETERMINISTIC";
  let expiresAt = rankSnapshotExpiryUtc(dayKey);

  const shouldAttemptAi = totalCap > 0 && aiItems.length > totalCap;
  if (shouldAttemptAi) {
    const readProfile = await getUserRssReadProfile(userId);
    const aiRanked = await rankItemsForDailyCap({
      sourceName: "All RSS Sources",
      dayKey,
      category: "mixed",
      cap: totalCap,
      userProfile: readProfile,
      items: aiItems,
    }).catch(() => null);

    if (aiRanked && aiRanked.length > 0) {
      rankedIds = aiRanked;
      status = "AI_SUCCESS";
    } else {
      expiresAt = new Date(Date.now() + FALLBACK_SNAPSHOT_TTL_MS);
    }
  }

  await prisma.userRssDailyRankSnapshot.upsert({
    where: { userId_dayKey: { userId, dayKey } },
    update: {
      rankedItemIds: rankedIds,
      status,
      source: "CRON",
      model: process.env.OPENROUTER_MODEL ?? null,
      inputFingerprint,
      expiresAt,
    },
    create: {
      userId,
      dayKey,
      rankedItemIds: rankedIds,
      status,
      source: "CRON",
      model: process.env.OPENROUTER_MODEL ?? null,
      inputFingerprint,
      expiresAt,
    },
  });

  return {
    candidates: aiItems.length,
    selected: rankedIds.length,
    status,
    totalCap,
  };
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dayKey = dayKeyUtc(new Date());
  const activeSources = await prisma.userRssSubscription.findMany({
    where: { isActive: true },
    select: { rssSourceId: true },
    distinct: ["rssSourceId"],
  });

  let syncedSources = 0;
  let syncInserted = 0;
  let syncUpdated = 0;
  const syncErrors: string[] = [];
  for (const row of activeSources) {
    try {
      const result = await syncRssSource(row.rssSourceId);
      syncInserted += result.inserted;
      syncUpdated += result.updated;
      syncedSources += 1;
    } catch (error) {
      syncErrors.push(
        `${row.rssSourceId}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  const activeUsers = await prisma.userRssSubscription.findMany({
    where: { isActive: true },
    select: { userId: true },
    distinct: ["userId"],
  });

  let rankedUsers = 0;
  const rankErrors: string[] = [];
  const rankSummaries: Array<{
    userId: string;
    candidates: number;
    selected: number;
    status: string;
    totalCap: number;
  }> = [];

  for (const row of activeUsers) {
    try {
      const result = await refreshTodaySnapshotForUser(row.userId, dayKey);
      rankedUsers += 1;
      rankSummaries.push({
        userId: row.userId,
        candidates: result.candidates,
        selected: result.selected,
        status: result.status,
        totalCap: result.totalCap,
      });
    } catch (error) {
      rankErrors.push(`${row.userId}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  return NextResponse.json({
    ok: true,
    dayKey,
    syncedSources,
    syncInserted,
    syncUpdated,
    rankedUsers,
    syncErrors,
    rankErrors,
    rankSummaries: rankSummaries.slice(0, 20),
  });
}

export async function POST(req: Request) {
  return GET(req);
}
