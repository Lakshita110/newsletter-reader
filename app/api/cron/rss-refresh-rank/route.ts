import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncRssSource } from "@/lib/rss";
import { computeDailyRankedSelection } from "@/lib/rss-ranking";
import {
  buildRssArticleDedupKey,
  dedupeByArticleKey,
  dayKeyUtc,
  getRssDailyTargetCap,
  rssPriorityScore,
  sortByPriorityAndRecency,
} from "@/lib/rss-helpers";
import { normalizeRecommendationPrompt } from "@/lib/rss-recommendation-settings";

type RssPriority = "HIGH" | "NORMAL" | "LOW";

type Candidate = {
  id: string;
  sourceName: string;
  dedupKey: string;
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

function rankSnapshotExpiryUtc(dayKey: string): Date {
  const nextDay = new Date(`${dayKey}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return nextDay;
}

async function refreshTodaySnapshotForUser(userId: string, dayKey: string) {
  const userSettings = await prisma.user.findUnique({
    where: { id: userId },
    select: { rssRecommendationPrompt: true },
  });
  const customPrompt = normalizeRecommendationPrompt(userSettings?.rssRecommendationPrompt) ?? "";

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
        sourceName: sub.source.name,
        dedupKey: buildRssArticleDedupKey({
          externalUrl: item.link,
          title: item.title,
          snippet: item.snippet ?? "",
        }),
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
  const dedupedCandidates = dedupeByArticleKey(
    unreadCandidates,
    (candidate) => rssPriorityScore(candidate.priority),
    (candidate) => candidate.sortTimeMs
  );

  const sortedFallback = sortByPriorityAndRecency(
    dedupedCandidates,
    (candidate) => candidate.priority,
    (candidate) => candidate.sortTimeMs
  );
  const totalCap = getRssDailyTargetCap(sortedFallback.length);

  const aiItems = sortedFallback.map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    snippet: candidate.snippet,
    author: candidate.author,
    sourceName: candidate.sourceName,
    publishedAtIso: candidate.publishedAtIso,
  }));
  const ranking = await computeDailyRankedSelection({
    userId,
    dayKey,
    cap: totalCap,
    rankedItems: aiItems,
    customPrompt,
  });
  const rankedIds = ranking.selectedIds;
  const status: "AI_SUCCESS" | "FALLBACK_DETERMINISTIC" = ranking.status;
  let expiresAt = rankSnapshotExpiryUtc(dayKey);
  if (status !== "AI_SUCCESS" && totalCap > 0 && aiItems.length > 0) {
    expiresAt = new Date(Date.now() + FALLBACK_SNAPSHOT_TTL_MS);
  }

  await prisma.userRssDailyRankSnapshot.upsert({
    where: { userId_dayKey: { userId, dayKey } },
    update: {
      rankedItemIds: rankedIds,
      status,
      source: "CRON",
      model: process.env.OPENROUTER_MODEL ?? null,
      inputFingerprint: ranking.inputFingerprint,
      expiresAt,
    },
    create: {
      userId,
      dayKey,
      rankedItemIds: rankedIds,
      status,
      source: "CRON",
      model: process.env.OPENROUTER_MODEL ?? null,
      inputFingerprint: ranking.inputFingerprint,
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
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  console.info(
    `[rss-refresh-rank][${requestId}] invoked method="${req.method}" userAgent="${req.headers.get("user-agent") ?? ""}" hasAuth="${Boolean(req.headers.get("authorization"))}" hasCronSecret="${Boolean(req.headers.get("x-cron-secret"))}"`
  );
  if (!isAuthorized(req)) {
    console.warn(`[rss-refresh-rank][${requestId}] unauthorized`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const dayKey = dayKeyUtc(new Date());
    const activeSources = await prisma.userRssSubscription.findMany({
      where: { isActive: true },
      select: { rssSourceId: true },
      distinct: ["rssSourceId"],
    });
    console.info(
      `[rss-refresh-rank][${requestId}] starting sync day="${dayKey}" activeSources=${activeSources.length}`
    );

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
        console.info(
          `[rss-refresh-rank][${requestId}] synced sourceId="${row.rssSourceId}" inserted=${result.inserted} updated=${result.updated}`
        );
      } catch (error) {
        const message = `${row.rssSourceId}: ${error instanceof Error ? error.message : "Unknown error"}`;
        syncErrors.push(message);
        console.error(`[rss-refresh-rank][${requestId}] sync failed ${message}`);
      }
    }

    const activeUsers = await prisma.userRssSubscription.findMany({
      where: { isActive: true },
      select: { userId: true },
      distinct: ["userId"],
    });
    console.info(
      `[rss-refresh-rank][${requestId}] starting ranking day="${dayKey}" activeUsers=${activeUsers.length}`
    );

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
        console.info(
          `[rss-refresh-rank][${requestId}] ranked userId="${row.userId}" candidates=${result.candidates} selected=${result.selected} totalCap=${result.totalCap} status="${result.status}"`
        );
      } catch (error) {
        const message = `${row.userId}: ${error instanceof Error ? error.message : "Unknown error"}`;
        rankErrors.push(message);
        console.error(`[rss-refresh-rank][${requestId}] ranking failed ${message}`);
      }
    }

    console.info(
      `[rss-refresh-rank][${requestId}] completed day="${dayKey}" syncedSources=${syncedSources} syncInserted=${syncInserted} syncUpdated=${syncUpdated} rankedUsers=${rankedUsers} syncErrors=${syncErrors.length} rankErrors=${rankErrors.length}`
    );

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
  } catch (error) {
    console.error(
      `[rss-refresh-rank][${requestId}] fatal error`,
      error
    );
    return NextResponse.json({ error: "Cron execution failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET(req);
}
