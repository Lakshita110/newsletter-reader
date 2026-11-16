import { prisma } from "@/lib/prisma";
import { buildRankInputFingerprint, computeDailyRankedSelection } from "@/lib/rss-ranking";
import { getUserRssReadProfile } from "@/lib/rss-read-profile";
import { normalizeRecommendationPrompt } from "@/lib/rss-recommendation-settings";
import { buildRankingCandidates } from "@/lib/rss-candidates";
import {
  FALLBACK_SNAPSHOT_TTL_MS,
  type RankSnapshotSource,
  idsFromSnapshotJson,
  persistRankSnapshot,
  rankSnapshotExpiryUtc,
  readMostRecentSnapshot,
} from "@/lib/rank-snapshot";

/**
 * Re-rank one user's day and persist the snapshot. Shared by the cron job
 * (every user, a few times a day) and the "Rank now" button (one user, on
 * demand), so both follow the same skip-if-unchanged and
 * never-clobber-a-good-ranking rules.
 */
export async function refreshTodaySnapshotForUser(
  userId: string,
  dayKey: string,
  source: RankSnapshotSource = "CRON"
) {
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

  // An on-demand request against an unchanged *fallback* snapshot is someone
  // explicitly asking to retry the AI, so only cron honours the skip there.
  const retryFallback = source === "ON_DEMAND" && existing?.status !== "AI_SUCCESS";
  if (existing && existing.inputFingerprint === inputFingerprint && !retryFallback) {
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
    source,
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
