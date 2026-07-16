import { prisma } from "@/lib/prisma";
import { normalizeRssCategory } from "@/lib/rss-categories";
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
  sourceKind: "gmail" | "rss";
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
};

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
};

export type RankingCandidateSet = {
  /** Every candidate before read-filtering/dedupe — the inbox `visible` list. */
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
  /** Restrict to a single source (inbox source filter). Omit to rank all. */
  selectedSourceId?: string | null;
  /** Per-user cap override (inbox). Omit to use the env default. */
  recommendationCap?: number | null;
}): Promise<RankingCandidateSet> {
  const { userId, selectedSourceId, recommendationCap } = params;
  const now = params.now ?? new Date();
  const rollingCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const subscriptions = await prisma.userRssSubscription.findMany({
    where: {
      userId,
      isActive: true,
      ...(selectedSourceId ? { rssSourceId: selectedSourceId } : {}),
    },
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
      const feedItem: FeedItem = {
        id: `rss:${item.id}`,
        sourceId: sub.source.id,
        sourceKind: "rss",
        subject: item.title,
        from: item.author ?? sub.source.name,
        date: (item.publishedAt ?? item.createdAt).toISOString(),
        snippet: item.snippet ?? "",
        publicationName: sub.source.name,
        publicationKey: `rss:${sub.source.id}`,
        category: normalizeRssCategory(sub.category) ?? "other",
        isOverflow: false,
        externalUrl: item.link ?? undefined,
        imageUrl: item.imageUrl ?? extractImageUrlFromHtml(item.htmlRaw),
      };
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
  const unreadCandidates = allCandidates.filter(
    (candidate) => !readIdSet.has(candidate.feedItem.id)
  );
  const dedupedCandidates = dedupeByArticleKey(
    unreadCandidates,
    (candidate) => candidate.sortTimeMs
  );
  const sortedFallback = [...dedupedCandidates].sort((a, b) => b.sortTimeMs - a.sortTimeMs);

  const aiItems: AiRankItem[] = sortedFallback.map((candidate) => ({
    id: candidate.feedItem.id,
    title: candidate.item.title,
    snippet: candidate.item.snippet ?? "",
    author: candidate.item.author ?? null,
    sourceName: candidate.sourceName,
    publishedAtIso: (candidate.item.publishedAt ?? candidate.item.createdAt).toISOString(),
  }));

  const totalCap = getRssDailyTargetCap(sortedFallback.length, recommendationCap);

  return { allCandidates, sortedFallback, aiItems, totalCap };
}
