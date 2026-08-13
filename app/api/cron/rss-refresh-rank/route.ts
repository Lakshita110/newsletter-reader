import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncRssSource } from "@/lib/rss";
import { buildRankInputFingerprint, computeDailyRankedSelection } from "@/lib/rss-ranking";
import { dayKeyUtc } from "@/lib/rss-helpers";
import { getUserRssReadProfile } from "@/lib/rss-read-profile";
import { normalizeRecommendationPrompt } from "@/lib/rss-recommendation-settings";
import { buildRankingCandidates } from "@/lib/rss-candidates";
import { isCronAuthorized } from "@/lib/cron-auth";
import {
  FALLBACK_SNAPSHOT_TTL_MS,
  idsFromSnapshotJson,
  persistRankSnapshot,
  rankSnapshotExpiryUtc,
  readMostRecentSnapshot,
} from "@/lib/rank-snapshot";

export const dynamic = "force-dynamic";

export async function refreshTodaySnapshotForUser(userId: string, dayKey: string) {
  const userSettings = await prisma.user.findUnique({
    where: { id: userId },
    select: { rssRecommendationPrompt: true },
  });
  const customPrompt = normalizeRecommendationPrompt(userSettings?.rssRecommendationPrompt) ?? "";

  const { aiItems, totalCap } = await buildRankingCandidates({ userId });

  // Nothing about today's candidate pool has changed since the last snapshot
  // (same content, cap, prompt) — skip the OpenRouter call entirely. Cron
  // runs several times a day so it can pick up newly-synced articles, but
  // re-ranking on every run regardless of whether anything changed wastes a
  // call per user per run and risks a redundant call failing/downgrading
  // and clobbering a perfectly good existing ranking. Only a snapshot from
  // today that hasn't expired counts as "existing" for this check — the
  // inbox always serves readMostRecentSnapshot regardless of day or expiry,
  // but cron's own re-rank decision still needs both.
  const inputFingerprint = buildRankInputFingerprint(dayKey, totalCap, customPrompt, aiItems);
  const latest = await readMostRecentSnapshot(userId);
  const existing = latest && latest.dayKey === dayKey && latest.expiresAt.getTime() > Date.now() ? latest : null;
  const keepExisting = (snapshot: NonNullable<typeof existing>) => ({
    candidates: aiItems.length,
    selected: idsFromSnapshotJson(snapshot.rankedItemIds).length,
    status: snapshot.status,
    totalCap,
    skipped: true,
  });

  if (existing && existing.inputFingerprint === inputFingerprint) {
    return keepExisting(existing);
  }

  const readProfile = await getUserRssReadProfile(userId);
  const ranking = await computeDailyRankedSelection({
    userId,
    dayKey,
    cap: totalCap,
    rankedItems: aiItems,
    customPrompt,
    readProfile,
  });

  // A degraded re-rank must never erase an existing real ranking: if the
  // input changed but this attempt only produced the deterministic fallback
  // (rate limit, timeout, malformed output), keep serving the last good
  // AI_SUCCESS snapshot rather than emptying the Recommended tab. A later
  // cron run or on-demand request gets another chance.
  if (ranking.status !== "AI_SUCCESS" && existing?.status === "AI_SUCCESS") {
    return keepExisting(existing);
  }

  // A degraded snapshot gets a short TTL so the next request can retry sooner;
  // an empty day has nothing to retry, so it keeps the full-day expiry.
  const isDegraded = ranking.status !== "AI_SUCCESS" && totalCap > 0 && aiItems.length > 0;

  await persistRankSnapshot({
    userId,
    dayKey,
    rankedIds: ranking.selectedIds,
    rankReasons: ranking.rankReasons,
    status: ranking.status,
    source: "CRON",
    model: ranking.model,
    inputFingerprint: ranking.inputFingerprint,
    expiresAt: isDegraded
      ? new Date(Date.now() + FALLBACK_SNAPSHOT_TTL_MS)
      : rankSnapshotExpiryUtc(dayKey),
  });

  return {
    candidates: aiItems.length,
    selected: ranking.selectedIds.length,
    status: ranking.status,
    totalCap,
    skipped: false,
  };
}

export async function GET(req: Request) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  console.info(
    `[rss-refresh-rank][${requestId}] invoked method="${req.method}" userAgent="${req.headers.get("user-agent") ?? ""}" hasAuth="${Boolean(req.headers.get("authorization"))}" hasCronSecret="${Boolean(req.headers.get("x-cron-secret"))}"`
  );
  if (!isCronAuthorized(req)) {
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

    const syncResults = await Promise.allSettled(
      activeSources.map((row) => syncRssSource(row.rssSourceId))
    );

    let syncedSources = 0;
    let syncInserted = 0;
    let syncUpdated = 0;
    const syncErrors: string[] = [];

    for (let i = 0; i < activeSources.length; i++) {
      const row = activeSources[i];
      const result = syncResults[i];
      if (result.status === "fulfilled") {
        syncInserted += result.value.inserted;
        syncUpdated += result.value.updated;
        syncedSources += 1;
        console.info(
          `[rss-refresh-rank][${requestId}] synced sourceId="${row.rssSourceId}" inserted=${result.value.inserted} updated=${result.value.updated}`
        );
      } else {
        const message = `${row.rssSourceId}: ${result.reason instanceof Error ? result.reason.message : "Unknown error"}`;
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
    let skippedUsers = 0;
    const rankErrors: string[] = [];
    const rankSummaries: Array<{
      userId: string;
      candidates: number;
      selected: number;
      status: string;
      totalCap: number;
      skipped: boolean;
    }> = [];

    for (const row of activeUsers) {
      try {
        const result = await refreshTodaySnapshotForUser(row.userId, dayKey);
        rankedUsers += 1;
        if (result.skipped) skippedUsers += 1;
        rankSummaries.push({ userId: row.userId, ...result });
        console.info(
          `[rss-refresh-rank][${requestId}] ranked userId="${row.userId}" candidates=${result.candidates} selected=${result.selected} totalCap=${result.totalCap} status="${result.status}" skipped=${result.skipped}`
        );
      } catch (error) {
        const message = `${row.userId}: ${error instanceof Error ? error.message : "Unknown error"}`;
        rankErrors.push(message);
        console.error(`[rss-refresh-rank][${requestId}] ranking failed ${message}`);
      }
    }

    console.info(
      `[rss-refresh-rank][${requestId}] completed day="${dayKey}" syncedSources=${syncedSources} syncInserted=${syncInserted} syncUpdated=${syncUpdated} rankedUsers=${rankedUsers} skippedUsers=${skippedUsers} syncErrors=${syncErrors.length} rankErrors=${rankErrors.length}`
    );

    return NextResponse.json({
      ok: true,
      dayKey,
      syncedSources,
      syncInserted,
      syncUpdated,
      rankedUsers,
      skippedUsers,
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
