import { prisma } from "@/lib/prisma";
import { getStoredNewsletterFeed } from "@/lib/newsletter-sync";
import type { FeedItem } from "@/lib/rss-candidates";

/**
 * The weekly recap: what she read, what she highlighted, and newsletters
 * from the past week worth a second look.
 *
 * "Read" vs "cleared": swiping a row away and finishing it both set
 * completedAt, so time spent in the reader is the only signal that she
 * actually read it. Anything under READ_SECONDS counts as cleared.
 */
export const RECAP_DAYS = 7;
/** How far back her reading habits are measured, to rank the second-look picks. */
const AFFINITY_DAYS = 30;
const READ_SECONDS = 30;
const SECOND_LOOK_LIMIT = 5;
const HIGHLIGHT_LIMIT = 12;

export type RecapStat = {
  messageExternalId: string;
  messageTitle: string | null;
  publicationName: string | null;
  sourceKind: string | null;
  totalSecondsRead: number;
  completedAt: Date | null;
};

export type RecapHighlight = {
  id: string;
  itemId: string;
  itemTitle: string;
  publicationName: string | null;
  quote: string;
};

export type Recap = {
  since: string;
  read: Array<{ id: string; title: string; publicationName: string | null; minutes: number }>;
  minutesRead: number;
  clearedCount: number;
  topPublications: Array<{ name: string; count: number }>;
  highlights: RecapHighlight[];
  secondLook: Array<Pick<FeedItem, "id" | "subject" | "publicationName" | "date" | "readMinutes" | "snippet">>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Pure part, so the rules above are testable without a database. */
export function buildRecap(input: {
  now: Date;
  /** Read stats from the last AFFINITY_DAYS (a superset of the recap week). */
  stats: RecapStat[];
  highlights: RecapHighlight[];
  /** Stored newsletter issues; anything older than the recap week is ignored. */
  newsletters: FeedItem[];
}): Recap {
  const since = new Date(input.now.getTime() - RECAP_DAYS * DAY_MS);
  const inWeek = input.stats.filter((s) => s.completedAt && s.completedAt >= since);
  const read = inWeek
    .filter((s) => s.totalSecondsRead >= READ_SECONDS)
    .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime())
    .map((s) => ({
      id: s.messageExternalId,
      title: s.messageTitle ?? "(Untitled)",
      publicationName: s.publicationName,
      minutes: Math.max(1, Math.round(s.totalSecondsRead / 60)),
    }));

  const counts = new Map<string, number>();
  for (const item of read) {
    if (item.publicationName) counts.set(item.publicationName, (counts.get(item.publicationName) ?? 0) + 1);
  }
  const topPublications = [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5);

  // Affinity: how many issues of each newsletter she actually read in the last month.
  const affinity = new Map<string, number>();
  for (const s of input.stats) {
    if (s.sourceKind === "gmail" && s.publicationName && s.totalSecondsRead >= READ_SECONDS) {
      affinity.set(s.publicationName, (affinity.get(s.publicationName) ?? 0) + 1);
    }
  }
  const readIds = new Set(
    input.stats.filter((s) => s.totalSecondsRead >= READ_SECONDS).map((s) => s.messageExternalId)
  );
  // Unread *or* swiped away unread: both are "skipped". Best-loved newsletters first, then newest.
  const secondLook = input.newsletters
    .filter((n) => new Date(n.date) >= since && !readIds.has(n.id))
    .sort(
      (a, b) =>
        (affinity.get(b.publicationName) ?? 0) - (affinity.get(a.publicationName) ?? 0) ||
        new Date(b.date).getTime() - new Date(a.date).getTime()
    )
    .slice(0, SECOND_LOOK_LIMIT)
    .map(({ id, subject, publicationName, date, readMinutes, snippet }) => ({
      id,
      subject,
      publicationName,
      date,
      readMinutes,
      snippet,
    }));

  return {
    since: since.toISOString(),
    read,
    minutesRead: read.reduce((sum, r) => sum + r.minutes, 0),
    clearedCount: inWeek.length - read.length,
    topPublications,
    highlights: input.highlights.slice(0, HIGHLIGHT_LIMIT),
    secondLook,
  };
}

export async function loadRecap(userId: string, now = new Date()): Promise<Recap> {
  const affinitySince = new Date(now.getTime() - AFFINITY_DAYS * DAY_MS);
  const weekSince = new Date(now.getTime() - RECAP_DAYS * DAY_MS);
  const [stats, highlights, newsletters] = await Promise.all([
    prisma.messageReadStat.findMany({
      where: { userId, completedAt: { gte: affinitySince } },
      select: {
        messageExternalId: true,
        messageTitle: true,
        publicationName: true,
        sourceKind: true,
        totalSecondsRead: true,
        completedAt: true,
      },
    }),
    prisma.highlight.findMany({
      where: { userId, createdAt: { gte: weekSince } },
      orderBy: { createdAt: "desc" },
      take: HIGHLIGHT_LIMIT,
      select: { id: true, itemId: true, itemTitle: true, publicationName: true, quote: true },
    }),
    getStoredNewsletterFeed(userId),
  ]);
  return buildRecap({ now, stats, highlights, newsletters });
}
