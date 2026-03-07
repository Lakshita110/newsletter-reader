import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncRssSource } from "@/lib/rss";
import { rankItemsForDailyCap } from "@/lib/rss-daily-cap-ranker";
import { dayKeyUtc, getRssDailyTargetCap, getUserRssReadProfile } from "@/lib/rss-helpers";

type RssPriority = "HIGH" | "NORMAL" | "LOW";

type Candidate = {
  id: string;
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

async function refreshTodaySnapshotForUser(userId: string, dayKey: string) {
  const rollingCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const subscriptions = await prisma.userRssSubscription.findMany({
    where: { userId, isActive: true },
    include: {
      source: {
        include: {
          items: {
            where: {
              OR: [
                { publishedAt: { gte: rollingCutoff } },
                { AND: [{ publishedAt: null }, { createdAt: { gte: rollingCutoff } }] },
              ],
            },
            orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
            take: 300,
          },
        },
      },
    },
  });

  const candidates: Candidate[] = [];
  for (const sub of subscriptions) {
    for (const item of sub.source.items) {
      candidates.push({
        id: `rss:${item.id}`,
        priority: sub.priority,
        sortTimeMs: item.publishedAt?.getTime() ?? item.createdAt.getTime(),
        title: item.title,
        snippet: item.snippet ?? "",
        author: item.author ?? null,
        publishedAtIso: (item.publishedAt ?? item.createdAt).toISOString(),
      });
    }
  }

  const candidateIds = candidates.map((candidate) => candidate.id);
  const readRows =
    candidateIds.length === 0
      ? []
      : await prisma.messageReadStat.findMany({
          where: {
            userId,
            messageExternalId: { in: candidateIds },
            OR: [{ completedAt: { not: null } }, { completionPct: { gte: 99 } }],
          },
          select: { messageExternalId: true },
        });
  const readIdSet = new Set(readRows.map((row) => row.messageExternalId));
  const unreadCandidates = candidates.filter((candidate) => !readIdSet.has(candidate.id));

  const sortedFallback = unreadCandidates.sort((a, b) => {
    const pa = priorityScore(a.priority);
    const pb = priorityScore(b.priority);
    if (pa !== pb) return pb - pa;
    return b.sortTimeMs - a.sortTimeMs;
  });
  const totalCap = getRssDailyTargetCap(sortedFallback.length);

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
      const ordered = [...aiRanked];
      for (const fallbackId of deterministicIds) {
        if (ordered.length >= totalCap) break;
        if (ordered.includes(fallbackId)) continue;
        ordered.push(fallbackId);
      }
      rankedIds = ordered.slice(0, totalCap);
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
