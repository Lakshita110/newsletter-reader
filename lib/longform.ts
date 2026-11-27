import { prisma } from "@/lib/prisma";

/**
 * Which RSS feeds are newsletters (long-form reading) rather than news.
 *
 * Why this matters: news feeds are ranked and only live in Today for a day.
 * A weekly essay from a Substack ranked against NYT and WSJ headlines either
 * crowds the news out or gets buried, and is gone after 24 hours. Long-form
 * feeds are handled like email newsletters instead: never ranked, kept in the
 * Newsletters tab for 30 days, and woven into Today while they're fresh.
 *
 * The signal is posting rate. RSS items are stored without their body, so
 * article length isn't available, but a newsletter posts a few times a week
 * at most while a news feed posts dozens of times a day. An explicit
 * "newsletter" category or a substack.com feed always counts.
 */
export const LONGFORM_WINDOW_DAYS = 14;
/**
 * At most ~3 posts a week. One a day let low-volume news sites (ProPublica)
 * through as "newsletters"; the essay newsletters she reads post weekly or
 * a couple of times a week.
 */
export const LONGFORM_MAX_POSTS = 7;
/** Categories that say "this is news", which wins over the posting-rate guess. */
const NEWS_CATEGORIES = new Set(["news", "politics", "world", "business", "finance", "science", "tech"]);

export function isLongformSource(source: { category: string | null; rssUrl: string; recentPosts: number }): boolean {
  if (source.category === "newsletter") return true;
  if (source.category && NEWS_CATEGORIES.has(source.category)) return false;
  if (hostOf(source.rssUrl).endsWith("substack.com")) return true;
  return source.recentPosts <= LONGFORM_MAX_POSTS;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Ids of the RssSources among `subscriptions` that are long-form. */
export async function longformSourceIds(
  subscriptions: Array<{ rssSourceId: string; category: string | null; source: { rssUrl: string } }>,
  now = new Date()
): Promise<Set<string>> {
  if (subscriptions.length === 0) return new Set();
  const since = new Date(now.getTime() - LONGFORM_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const counts = await prisma.rssItem.groupBy({
    by: ["rssSourceId"],
    where: {
      rssSourceId: { in: subscriptions.map((s) => s.rssSourceId) },
      OR: [{ publishedAt: { gte: since } }, { AND: [{ publishedAt: null }, { createdAt: { gte: since } }] }],
    },
    _count: { _all: true },
  });
  const recent = new Map(counts.map((row) => [row.rssSourceId, row._count._all]));
  return new Set(
    subscriptions
      .filter((s) =>
        isLongformSource({ category: s.category, rssUrl: s.source.rssUrl, recentPosts: recent.get(s.rssSourceId) ?? 0 })
      )
      .map((s) => s.rssSourceId)
  );
}
