import { prisma } from "@/lib/prisma";

/**
 * Persistence layer for the per-user daily ranking snapshot
 * (UserRssDailyRankSnapshot) and its cross-instance job lock
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
