import { prisma } from "@/lib/prisma";

/**
 * What her recent reading says about what to pick next: stories she opened
 * (more like these) and stories she swiped off Today without opening (fewer
 * like these). The ranker gets this fresh on every run. The weekly reading
 * profile (lib/rss-read-profile) is cached for a week, so on its own a skip
 * or a read today wouldn't show up in recommendations until next week.
 */

export type ReadStatRow = {
  messageTitle: string | null;
  publicationName: string | null;
  openCount: number;
  totalSecondsRead: number;
  completionPct: number;
  firstOpenedAt: Date | null;
  completedAt: Date | null;
  savedAt: Date | null;
};

export type ReadingSignal = "read" | "skipped" | null;

/**
 * Before the "dismissed" state existed, a swipe sent "read", which created the
 * row with one visit stamped at the same instant as completion. A real read
 * has its visit ("opened") first, so the two times differ by far more.
 */
const LEGACY_SWIPE_WINDOW_MS = 2000;

/**
 * - skipped: finished without ever being opened (a swipe, Done, Mark all read).
 * - read: opened, saved, or time spent in the reader.
 * - null: no signal yet (e.g. a row that only exists because of an Undo).
 */
export function classifyReadStat(row: ReadStatRow): ReadingSignal {
  if (row.savedAt || row.totalSecondsRead > 0) return "read";
  if (row.completedAt && row.openCount === 0) return "skipped";
  if (
    row.completedAt &&
    row.openCount === 1 &&
    row.firstOpenedAt &&
    Math.abs(row.completedAt.getTime() - row.firstOpenedAt.getTime()) < LEGACY_SWIPE_WINDOW_MS
  ) {
    return "skipped";
  }
  if (row.openCount > 0 || row.completionPct > 0) return "read";
  return null;
}

export type ReadingSignals = {
  /** Newest first: "source | title". */
  recentReads: string[];
  recentSkips: string[];
  /** Sources she mostly skips: more skips than reads, and at least a few of them. */
  oftenSkippedSources: Array<{ name: string; skipped: number; read: number }>;
};

export const SIGNAL_DAYS = 14;
export const MAX_SIGNAL_TITLES = 25;
const MIN_SKIPS_FOR_SOURCE = 3;

/** Rows must be newest first. Pure, so the thresholds are unit tested. */
export function summarizeReadingSignals(rows: ReadStatRow[]): ReadingSignals {
  const recentReads: string[] = [];
  const recentSkips: string[] = [];
  const bySource = new Map<string, { skipped: number; read: number }>();
  for (const row of rows) {
    const signal = classifyReadStat(row);
    if (!signal) continue;
    const source = row.publicationName?.trim() || "unknown";
    const title = row.messageTitle?.trim();
    const counts = bySource.get(source) ?? { skipped: 0, read: 0 };
    if (signal === "read") counts.read += 1;
    else counts.skipped += 1;
    bySource.set(source, counts);
    if (!title) continue;
    const list = signal === "read" ? recentReads : recentSkips;
    if (list.length < MAX_SIGNAL_TITLES) list.push(`${source} | ${title}`);
  }
  const oftenSkippedSources = [...bySource.entries()]
    .filter(([name, c]) => name !== "unknown" && c.skipped >= MIN_SKIPS_FOR_SOURCE && c.skipped > c.read)
    .map(([name, c]) => ({ name, ...c }))
    .sort((a, b) => b.skipped - a.skipped)
    .slice(0, 10);
  return { recentReads, recentSkips, oftenSkippedSources };
}

/** Her last two weeks of reads and skips, across newsletters and stories. */
export async function getRecentReadingSignals(userId: string, now = new Date()): Promise<ReadingSignals> {
  const since = new Date(now.getTime() - SIGNAL_DAYS * 86_400_000);
  const rows = await prisma.messageReadStat.findMany({
    where: {
      userId,
      OR: [{ completedAt: { gte: since } }, { lastOpenedAt: { gte: since } }, { savedAt: { gte: since } }],
    },
    // Newest activity first; updatedAt moves on every change, so it covers
    // rows that were only finished, only opened, or only saved.
    orderBy: { updatedAt: "desc" },
    take: 400,
    select: {
      messageTitle: true,
      publicationName: true,
      openCount: true,
      totalSecondsRead: true,
      completionPct: true,
      firstOpenedAt: true,
      completedAt: true,
      savedAt: true,
    },
  });
  return summarizeReadingSignals(rows);
}
