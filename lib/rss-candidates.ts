import { prisma } from "@/lib/prisma";
import { normalizeRssCategory } from "@/lib/rss-categories";
import { countSourceCoverage } from "@/lib/story-buzz";
import {
  buildRssArticleDedupKey,
  dedupeByArticleKey,
  extractImageUrlFromHtml,
  getRssDailyTargetCap,
} from "@/lib/rss-helpers";

/**
 * A feed row as rendered by the inbox. Also used for Gmail newsletter items,
 * which is why the shape carries mail-only fields (subject/from/date). RSS
 * candidates fill it from `RssItem`.
 */
export type FeedItem = {
  id: string;
  sourceId?: string;
  sourceKind: "gmail" | "rss" | "web";
  subject: string;
  from: string;
  date: string;
  snippet: string;
  publicationName: string;
  publicationKey: string;
  category?: string;
  isOverflow?: boolean;
  externalUrl?: string;
  imageUrl?: string;
  /** How many of her other sources run the same story (RSS only, lib/story-buzz.ts). */
  coverage?: number;
  /** Set when a recent newsletter already covered this story (see lib/coverage.ts). */
  coveredBy?: { byId: string; publicationName: string; subject: string; matched: string[] };
};

type RssItemRow = {
  id: string;
  title: string;
  author: string | null;
  link: string | null;
  imageUrl: string | null;
  htmlRaw: string | null;
  snippet: string | null;
  publishedAt: Date | null;
  createdAt: Date;
};

/** Map a stored RssItem row to the FeedItem shape every feed endpoint returns. */
export function toFeedItem(item: RssItemRow, source: { id: string; name: string }, category?: string | null): FeedItem {
  return {
    id: `rss:${item.id}`,
    sourceId: source.id,
    sourceKind: "rss",
    subject: item.title,
    from: item.author ?? source.name,
    date: (item.publishedAt ?? item.createdAt).toISOString(),
    snippet: item.snippet ?? "",
    publicationName: source.name,
    publicationKey: `rss:${source.id}`,
    category: normalizeRssCategory(category ?? "") ?? "other",
    isOverflow: false,
    externalUrl: item.link ?? undefined,
    imageUrl: item.imageUrl ?? extractImageUrlFromHtml(item.htmlRaw),
  };
}

/**
 * One RSS article in ranking form: the raw item fields the ranker/eval needs,
 * plus the pre-built `feedItem` the inbox renders and a precomputed sort key.
 */
export type RankingCandidate = {
  sourceId: string;
  sourceName: string;
  dedupKey: string;
  item: {
    title: string;
    snippet: string | null;
    author: string | null;
    publishedAt: Date | null;
    createdAt: Date;
  };
  feedItem: FeedItem;
  sortTimeMs: number;
};

/** The compact item shape handed to the AI ranker / eval / snapshot. */
export type AiRankItem = {
  id: string;
  title: string;
  snippet: string;
  author: string | null;
  sourceName: string;
  publishedAtIso: string;
  /** How many of her other sources run the same story today (lib/story-buzz.ts). */
  coverage?: number;
};

export type RankingCandidateSet = {
  /** Every RSS candidate before read-filtering/dedupe — the inbox `visible` list. */
  allCandidates: RankingCandidate[];
  /** Unread, deduped, recency sorted — the ranking input pool. */
  sortedFallback: RankingCandidate[];
  /** `sortedFallback` mapped to the ranker/snapshot shape. */
  aiItems: AiRankItem[];
  /** Per-day cap given the pool size (and optional per-user override). */
  totalCap: number;
};

/**
 * Build the daily RSS ranking candidate pool for a user.
 *
 * This is the single source of truth for the "subscriptions in the last 24h ->
 * strip read items -> dedupe -> sort -> cap" pipeline that both the inbox
 * request path and the refresh cron rank over. Keeping it in one place matters
 * because the inbox fingerprints its ranking snapshot over `aiItems` (id +
 * order): if the two call sites ever built candidates differently, every
 * cached snapshot would look stale and re-rank on load.
 */
export async function buildRankingCandidates(params: {
  userId: string;
  now?: Date;
  /** Per-user cap override (inbox). Omit to use the env default. */
  recommendationCap?: number | null;
}): Promise<RankingCandidateSet> {
  const { userId, recommendationCap } = params;
  const now = params.now ?? new Date();
  const rollingCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

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

  const allCandidates: RankingCandidate[] = [];
  for (const sub of subscriptions) {
    for (const item of sub.source.items) {
      const feedItem = toFeedItem(item, sub.source, sub.category);
      allCandidates.push({
        sourceId: sub.source.id,
        sourceName: sub.source.name,
        dedupKey: buildRssArticleDedupKey({
          externalUrl: item.link,
          title: item.title,
          snippet: item.snippet ?? "",
        }),
        item: {
          title: item.title,
          snippet: item.snippet ?? null,
          author: item.author ?? null,
          publishedAt: item.publishedAt ?? null,
          createdAt: item.createdAt,
        },
        feedItem,
        sortTimeMs: item.publishedAt?.getTime() ?? item.createdAt.getTime(),
      });
    }
  }

  const candidateIds = allCandidates.map((candidate) => candidate.feedItem.id);
  const [readRows, newsletterKeys] = await Promise.all([
    candidateIds.length === 0
      ? []
      : prisma.messageReadStat.findMany({
          where: {
            userId,
            messageExternalId: { in: candidateIds },
            OR: [{ completedAt: { not: null } }, { completionPct: { gte: 99 } }],
          },
          select: { messageExternalId: true },
        }),
    newsletterDedupKeys(userId, now),
  ]);
  const readIdSet = new Set(readRows.map((row) => row.messageExternalId));
  // Newsletters aren't ranked (Today always shows them first), but a Substack
  // that also arrives through its RSS feed must not show up twice: keep the
  // email copy, which has the full (including paid) post.
  const unreadCandidates = allCandidates.filter(
    (candidate) => !readIdSet.has(candidate.feedItem.id) && !newsletterKeys.has(candidate.dedupKey)
  );
  const dedupedCandidates = dedupeByArticleKey(unreadCandidates, (candidate) => candidate.sortTimeMs);
  const sortedFallback = [...dedupedCandidates].sort((a, b) => b.sortTimeMs - a.sortTimeMs);

  const coverage = countSourceCoverage(
    sortedFallback.map((c) => ({
      id: c.feedItem.id,
      sourceName: c.sourceName,
      title: c.item.title,
      snippet: c.item.snippet,
    }))
  );
  for (const candidate of sortedFallback) {
    candidate.feedItem.coverage = coverage.get(candidate.feedItem.id) ?? 0;
  }
  const aiItems: AiRankItem[] = sortedFallback.map((candidate) => ({
    id: candidate.feedItem.id,
    title: candidate.item.title,
    snippet: candidate.item.snippet ?? "",
    author: candidate.item.author ?? null,
    sourceName: candidate.sourceName,
    publishedAtIso: (candidate.item.publishedAt ?? candidate.item.createdAt).toISOString(),
    coverage: coverage.get(candidate.feedItem.id) ?? 0,
  }));

  const totalCap = getRssDailyTargetCap(sortedFallback.length, recommendationCap);

  return { allCandidates, sortedFallback, aiItems, totalCap };
}

/** Newsletter issues this recent are checked for RSS duplicates of the same post. */
const NEWSLETTER_DEDUP_DAYS = 7;

async function newsletterDedupKeys(userId: string, now: Date): Promise<Set<string>> {
  const issues = await prisma.newsletterIssue.findMany({
    where: {
      userId,
      receivedAt: { gte: new Date(now.getTime() - NEWSLETTER_DEDUP_DAYS * 86_400_000) },
      webUrl: { not: null },
    },
    select: { webUrl: true },
  });
  return new Set(issues.map((issue) => buildRssArticleDedupKey({ externalUrl: issue.webUrl })));
}
