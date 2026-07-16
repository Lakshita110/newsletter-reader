import { prisma } from "@/lib/prisma";
import type { RankingCandidate } from "@/lib/rss-candidates";

/**
 * Persistence and reads for the per-user daily ranking snapshot
 * (UserRssDailyRankSnapshot). Cron is the only writer — it ranks each user
 * a few times a day (see vercel.json) and persists the result here. The
 * inbox never ranks on demand; it only ever reads back "whatever cron last
 * computed" and reconciles it against the currently-visible candidate pool
 * (dropping ids that have since been read, deleted, or aged out of the 24h
 * window). That reconciliation is a pure local filter, not ranking.
 */

export type RankSnapshotStatus = "AI_SUCCESS" | "FALLBACK_DETERMINISTIC";
export type RankSnapshotSource = "CRON" | "ON_DEMAND";

/** How long a deterministic-fallback snapshot stays valid before cron will overwrite it with a fresh attempt. */
export const FALLBACK_SNAPSHOT_TTL_MS = 45 * 60 * 1000;

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

/**
 * Most recent snapshot for the user regardless of day or expiry — this is
 * "the last ranking" the inbox always serves.
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
 * it still has a matching reason today. Only AI_SUCCESS snapshots ever have
 * recommendations; FALLBACK_DETERMINISTIC is never "recommended".
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

export type RankedIdsResult = {
  selectedRankIds: string[] | null;
  recommendedRankIds: string[];
  rankReasons: Record<string, string>;
  status: RankSnapshotStatus | null;
  rankedAt: string | null;
};

/**
 * Read the last ranking cron produced for this user and reconcile it against
 * the currently-visible candidate pool. Never computes a fresh ranking —
 * if cron hasn't ranked this user yet, there's simply nothing to recommend
 * until the next cron run.
 */
export async function getLatestRankedIds(params: {
  userId: string;
  sortedFallback: RankingCandidate[];
  cap: number;
}): Promise<RankedIdsResult> {
  const { userId, sortedFallback, cap } = params;
  const snapshot = await readMostRecentSnapshot(userId);
  if (!snapshot) {
    return { selectedRankIds: null, recommendedRankIds: [], rankReasons: {}, status: null, rankedAt: null };
  }

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
    rankedAt: snapshot.updatedAt.toISOString(),
  };
}
