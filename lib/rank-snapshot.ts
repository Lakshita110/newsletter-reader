import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { buildRankInputFingerprint, computeDailyRankedSelection } from "@/lib/rss-ranking";
import type { AiRankItem, RankingCandidate } from "@/lib/rss-candidates";
import type { RssReadProfile } from "@/lib/rss-read-profile";

/**
 * Persistence and on-demand orchestration for the per-user daily ranking
 * snapshot (UserRssDailyRankSnapshot) and its cross-instance job lock
 * (UserRssRankJobLock). Shared by the inbox request path and the refresh
 * cron so the two writers can never drift in how snapshots are stored,
 * expired, or locked.
 */

export type RankSnapshotStatus = "AI_SUCCESS" | "FALLBACK_DETERMINISTIC";
export type RankSnapshotSource = "CRON" | "ON_DEMAND";

/** How long a deterministic-fallback snapshot stays valid before a re-rank is allowed. */
export const FALLBACK_SNAPSHOT_TTL_MS = 45 * 60 * 1000;

/** Lease on the DB rank-job lock; a crashed owner's lock expires after this. */
export const RANK_LOCK_LEASE_MS = 60_000;
/** How long a request that lost the lock race polls for the winner's snapshot. */
export const RANK_LOCK_WAIT_MS = 4_000;
const RANK_LOCK_POLL_MS = 350;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A successful snapshot for `dayKey` is valid until the next UTC day starts. */
export function rankSnapshotExpiryUtc(dayKey: string): Date {
  const nextDay = new Date(`${dayKey}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return nextDay;
}

export function idsFromSnapshotJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string");
}

export function snapshotRankReasons(snapshot: { rankReasons?: unknown }): Record<string, string> {
  const value = snapshot.rankReasons;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof k === "string" && typeof v === "string") out[k] = v;
  }
  return out;
}

export async function readValidRankSnapshot(userId: string, dayKey: string, now: Date) {
  return prisma.userRssDailyRankSnapshot.findFirst({
    where: { userId, dayKey, expiresAt: { gt: now } },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Most recent snapshot for the user regardless of day or expiry — used as the
 * instant stopgap on a cold start so the morning open shows yesterday's
 * ranking while today's ranks in the background.
 */
export async function readMostRecentSnapshot(userId: string) {
  return prisma.userRssDailyRankSnapshot.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
}

export async function persistRankSnapshot(args: {
  userId: string;
  dayKey: string;
  rankedIds: string[];
  rankReasons?: Record<string, string>;
  status: RankSnapshotStatus;
  source: RankSnapshotSource;
  model?: string | null;
  inputFingerprint: string;
  expiresAt: Date;
}) {
  const fields = {
    rankedItemIds: args.rankedIds,
    rankReasons: args.rankReasons ?? {},
    status: args.status,
    source: args.source,
    model: args.model ?? null,
    inputFingerprint: args.inputFingerprint,
    expiresAt: args.expiresAt,
  };
  await prisma.userRssDailyRankSnapshot.upsert({
    where: { userId_dayKey: { userId: args.userId, dayKey: args.dayKey } },
    update: fields,
    create: { userId: args.userId, dayKey: args.dayKey, ...fields },
  });
}

/**
 * DB-backed lock so only one instance ranks a given user+day at a time.
 * Expired leases from crashed owners are swept before acquiring.
 */
export async function tryAcquireRankLock(
  userId: string,
  dayKey: string,
  ownerId: string
): Promise<boolean> {
  const now = new Date();
  await prisma.userRssRankJobLock.deleteMany({
    where: { userId, dayKey, expiresAt: { lte: now } },
  });
  try {
    await prisma.userRssRankJobLock.create({
      data: {
        userId,
        dayKey,
        ownerId,
        expiresAt: new Date(now.getTime() + RANK_LOCK_LEASE_MS),
      },
    });
    return true;
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "P2002") return false;
    throw error;
  }
}

export async function releaseRankLock(userId: string, dayKey: string, ownerId: string): Promise<void> {
  await prisma.userRssRankJobLock.deleteMany({
    where: { userId, dayKey, ownerId },
  });
}

/** Poll for the lock winner's snapshot until it lands or the timeout passes. */
export async function waitForRankSnapshot(userId: string, dayKey: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await readValidRankSnapshot(userId, dayKey, new Date());
    if (snapshot) return snapshot;
    await sleep(RANK_LOCK_POLL_MS);
  }
  return null;
}

// Serve a snapshot ranked over slightly different inputs as-is when it's
// fresher than this; only re-rank once it's older.
const RANKING_STALENESS_TOLERANCE_MS = 4 * 60 * 60 * 1000;

export type RankedIdsResult = {
  selectedRankIds: string[] | null;
  recommendedRankIds: string[];
  rankReasons: Record<string, string>;
  status: RankSnapshotStatus | null;
  rankingPending: boolean;
  rankedAt: string | null;
};

/**
 * Keep only ranked ids that still exist in today's candidate pool, deduped
 * and capped. With `backfill`, fill any remaining space from the fallback
 * order so the feed always reaches the cap.
 */
export function selectRankedIds(
  rankedIds: string[],
  sortedFallback: RankingCandidate[],
  cap: number,
  opts?: { backfill?: boolean }
): string[] {
  const allowed = new Set(sortedFallback.map((candidate) => candidate.feedItem.id));
  const selected: string[] = [];
  const selectedSet = new Set<string>();
  for (const id of rankedIds) {
    if (!allowed.has(id) || selectedSet.has(id)) continue;
    selected.push(id);
    selectedSet.add(id);
    if (selected.length >= cap) break;
  }
  if (opts?.backfill && selected.length < cap) {
    for (const candidate of sortedFallback) {
      const id = candidate.feedItem.id;
      if (selectedSet.has(id)) continue;
      selected.push(id);
      selectedSet.add(id);
      if (selected.length >= cap) break;
    }
  }
  return selected;
}

export function deterministicFallbackIds(sortedFallback: RankingCandidate[], cap: number): string[] {
  return sortedFallback.slice(0, cap).map((candidate) => candidate.feedItem.id);
}

/**
 * Recommended-tab membership must never outrun the reasons we can show for
 * it — an id reconstructed from a stored snapshot is only "recommended" if
 * it still has a matching reason today. Shared by every site that derives
 * `recommendedRankIds` from persisted data, so the invariant holds
 * regardless of which read path served the response. Only AI_SUCCESS
 * snapshots ever have recommendations; FALLBACK_DETERMINISTIC is never
 * "recommended".
 */
function deriveRecommendedRankIds(
  ids: string[],
  reasons: Record<string, string>,
  isAiSuccess: boolean,
  sortedFallback: RankingCandidate[],
  cap: number
): string[] {
  if (!isAiSuccess) return [];
  return selectRankedIds(ids, sortedFallback, cap).filter((id) => Boolean(reasons[id]));
}

function resultFromSnapshot(
  snapshot: NonNullable<Awaited<ReturnType<typeof readValidRankSnapshot>>>,
  sortedFallback: RankingCandidate[],
  cap: number
): RankedIdsResult {
  const ids = idsFromSnapshotJson(snapshot.rankedItemIds);
  const reasons = snapshotRankReasons(snapshot);
  return {
    selectedRankIds: ids,
    recommendedRankIds: deriveRecommendedRankIds(
      ids,
      reasons,
      snapshot.status === "AI_SUCCESS",
      sortedFallback,
      cap
    ),
    rankReasons: reasons,
    status: snapshot.status,
    rankingPending: false,
    rankedAt: snapshot.updatedAt.toISOString(),
  };
}

type RankParams = {
  userId: string;
  dayKey: string;
  cap: number;
  sortedFallback: RankingCandidate[];
  readProfile: RssReadProfile;
  customPrompt: string;
  aiItems: AiRankItem[];
  requestTag: string;
};

/**
 * Take the rank-job lock and compute + persist today's snapshot. If the lock
 * is busy, poll briefly for the winner's snapshot instead of ranking twice.
 */
async function acquireAndRank(params: RankParams): Promise<RankedIdsResult> {
  const { userId, dayKey, cap, sortedFallback, readProfile, customPrompt, aiItems, requestTag } = params;
  const ownerId = randomUUID();
  const lockAcquired = await tryAcquireRankLock(userId, dayKey, ownerId);
  if (!lockAcquired) {
    console.info(`[rss-inbox][${requestTag}] ranking lock busy day="${dayKey}", polling snapshot`);
    const waited = await waitForRankSnapshot(userId, dayKey, RANK_LOCK_WAIT_MS);
    if (waited) return resultFromSnapshot(waited, sortedFallback, cap);
    console.warn(`[rss-inbox][${requestTag}] ranking lock wait timed out day="${dayKey}", using request fallback`);
    return { selectedRankIds: null, recommendedRankIds: [], rankReasons: {}, status: null, rankingPending: false, rankedAt: null };
  }

  try {
    const secondCheck = await readValidRankSnapshot(userId, dayKey, new Date());
    if (secondCheck) return resultFromSnapshot(secondCheck, sortedFallback, cap);

    const now = new Date();
    const ranking = await computeDailyRankedSelection({
      userId,
      dayKey,
      cap,
      rankedItems: aiItems,
      customPrompt,
      readProfile,
    });
    const isAiSuccess = ranking.status === "AI_SUCCESS";
    const selectedIds = ranking.selectedIds;
    await persistRankSnapshot({
      userId,
      dayKey,
      rankedIds: selectedIds,
      rankReasons: ranking.rankReasons,
      status: ranking.status,
      source: "ON_DEMAND",
      model: ranking.model,
      inputFingerprint: ranking.inputFingerprint,
      expiresAt: isAiSuccess ? rankSnapshotExpiryUtc(dayKey) : new Date(Date.now() + FALLBACK_SNAPSHOT_TTL_MS),
    });
    console.info(
      `[rss-inbox][${requestTag}] ranking snapshot persisted day="${dayKey}" status="${ranking.status}" ids=${selectedIds.length}`
    );
    return {
      selectedRankIds: selectedIds,
      recommendedRankIds: ranking.recommendedIds,
      rankReasons: ranking.rankReasons,
      status: ranking.status,
      rankingPending: false,
      rankedAt: now.toISOString(),
    };
  } finally {
    await releaseRankLock(userId, dayKey, ownerId);
  }
}

/**
 * Serve today's ranking for an inbox request without ever blocking on
 * OpenRouter: a valid snapshot is returned directly; a stale-but-recent one
 * is served as-is; otherwise the most recent prior ranking (or deterministic
 * order) is returned immediately with `rankingPending: true` while
 * `acquireAndRank` runs in the background. The client polls while pending
 * and swaps in the fresh ranking once it lands. Cross-instance coordination
 * comes from the DB lock inside acquireAndRank — losers of the race poll for
 * the winner's snapshot instead of ranking again.
 */
export async function getOrCreateTodayRankedIds(params: {
  userId: string;
  dayKey: string;
  cap: number;
  sortedFallback: RankingCandidate[];
  aiItems: AiRankItem[];
  readProfile: RssReadProfile;
  requestTag: string;
}): Promise<RankedIdsResult> {
  const { userId, dayKey, cap, sortedFallback, aiItems, readProfile, requestTag } = params;
  const normalizedPrompt = readProfile.customPrompt ?? "";
  const inputFingerprint = buildRankInputFingerprint(dayKey, cap, normalizedPrompt, aiItems);
  const rankParams: RankParams = {
    userId,
    dayKey,
    cap,
    sortedFallback,
    aiItems,
    readProfile,
    customPrompt: normalizedPrompt,
    requestTag,
  };

  const snapshot = await readValidRankSnapshot(userId, dayKey, new Date());
  if (snapshot) {
    const served = resultFromSnapshot(snapshot, sortedFallback, cap);
    if (snapshot.inputFingerprint === inputFingerprint) {
      console.info(`[rss-inbox][${requestTag}] ranking snapshot hit day="${dayKey}" status="${snapshot.status}" source="${snapshot.source}" ids=${served.selectedRankIds?.length ?? 0}`);
      return served;
    }

    // Stale fingerprint — only re-rank if snapshot is older than the staleness tolerance
    const snapshotAgeMs = Date.now() - snapshot.updatedAt.getTime();
    if (snapshotAgeMs < RANKING_STALENESS_TOLERANCE_MS) {
      console.info(`[rss-inbox][${requestTag}] ranking snapshot stale-input but fresh enough (${Math.round(snapshotAgeMs / 60000)}m old) day="${dayKey}" — serving as-is`);
      return served;
    }

    console.info(`[rss-inbox][${requestTag}] ranking snapshot stale-input and old (${Math.round(snapshotAgeMs / 60000)}m) day="${dayKey}" — background re-rank`);
    await prisma.userRssDailyRankSnapshot.delete({ where: { userId_dayKey: { userId, dayKey } } }).catch(() => null);

    void acquireAndRank(rankParams).catch(() => null);
    return {
      selectedRankIds: deterministicFallbackIds(sortedFallback, cap),
      recommendedRankIds: [],
      rankReasons: {},
      status: "FALLBACK_DETERMINISTIC",
      rankingPending: true,
      rankedAt: served.rankedAt,
    };
  }

  // No snapshot for today — serve the most recent prior ranking instantly and
  // rank today's in the background. This is the morning cold-start path:
  // before this, the first open of the UTC day awaited a live rank (several
  // seconds); now it shows yesterday's ranking immediately.
  void acquireAndRank(rankParams).catch(() => null);

  const prior = await readMostRecentSnapshot(userId);
  const priorIds = prior ? idsFromSnapshotJson(prior.rankedItemIds) : [];
  const priorIsAi = prior?.status === "AI_SUCCESS";
  const priorReasons = priorIsAi ? snapshotRankReasons(prior) : {};
  console.info(
    `[rss-inbox][${requestTag}] cold start day="${dayKey}" — serving ${priorIds.length > 0 ? `prior snapshot day="${prior?.dayKey ?? "?"}"` : "deterministic order"} while background rank runs`
  );
  return {
    selectedRankIds: priorIds.length > 0 ? priorIds : deterministicFallbackIds(sortedFallback, cap),
    recommendedRankIds: deriveRecommendedRankIds(priorIds, priorReasons, Boolean(priorIsAi), sortedFallback, cap),
    rankReasons: priorReasons,
    status: "FALLBACK_DETERMINISTIC",
    rankingPending: true,
    rankedAt: prior ? prior.updatedAt.toISOString() : null,
  };
}
