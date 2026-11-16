import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildRankingCandidates } from "@/lib/rss-candidates";
import { getStoredNewsletterFeed, syncNewsletters } from "@/lib/newsletter-sync";
import { getSavedArticleFeed } from "@/lib/saved-articles";
import { findCoverage, htmlToPlainText, type CoverageSource } from "@/lib/coverage";
import type { FeedItem } from "@/lib/rss-candidates";
import { getSessionUser } from "@/lib/session-user";
import { getLatestRankedIds, selectRankedIds } from "@/lib/rank-snapshot";
import { modelLabel } from "@/lib/openrouter";

export const dynamic = "force-dynamic";

async function getUserAndToken() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return null;
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: sessionUser.userId },
    select: { rssRecommendationCap: true },
  });
  return {
    userId: sessionUser.userId,
    // May be undefined if the Gmail token is missing/expired — that's fine,
    // syncNewsletters() handles a missing token on its own (stored issues
    // still render). RSS items don't
    // need it at all, so the whole route shouldn't 401 just because Gmail
    // access is unavailable.
    accessToken: sessionUser.accessToken,
    recommendationCap: user.rssRecommendationCap,
  };
}

async function getRssFeed(
  userId: string,
  selectedSourceId?: string | null,
  enableRanking: boolean = true,
  requestTag: string = "req",
  recommendationCap?: number | null
) {
  const overflowBySource = new Map<string, { sourceId: string; sourceName: string; count: number }>();
  const { allCandidates, sortedFallback, totalCap } = await buildRankingCandidates({
    userId,
    selectedSourceId,
    recommendationCap,
  });

  let selectedIds = new Set<string>();
  let recommendedIds = new Set<string>();
  let rankReasons: Record<string, string> = {};
  let rankedAt: string | null = null;
  let rankStatus: string | null = null;
  let rankModel: string | null = null;
  if (totalCap <= 0) {
    selectedIds = new Set();
  } else if (!enableRanking) {
    selectedIds = new Set(sortedFallback.slice(0, totalCap).map((candidate) => candidate.feedItem.id));
  } else {
    const rankingResult = await getLatestRankedIds({ userId, sortedFallback, cap: totalCap });
    rankedAt = rankingResult.rankedAt;
    rankStatus = rankingResult.status;
    rankModel = modelLabel(rankingResult.model);
    rankReasons = rankingResult.rankReasons;
    recommendedIds = new Set(rankingResult.recommendedRankIds);
    if (rankingResult.selectedRankIds && rankingResult.selectedRankIds.length > 0) {
      console.info(
        `[rss-inbox][${requestTag}] serving last ranking selected=${rankingResult.selectedRankIds.length} recommended=${rankingResult.recommendedRankIds.length} status="${rankingResult.status ?? "NONE"}" rankedAt="${rankedAt ?? ""}"`
      );
      selectedIds = new Set(
        selectRankedIds(rankingResult.selectedRankIds, sortedFallback, totalCap, { backfill: true })
      );
    } else {
      console.info(`[rss-inbox][${requestTag}] no ranking yet, using deterministic order`);
      selectedIds = new Set(sortedFallback.slice(0, totalCap).map((candidate) => candidate.feedItem.id));
    }
  }

  for (const candidate of sortedFallback) {
    candidate.feedItem.isOverflow = !selectedIds.has(candidate.feedItem.id);
    if (!candidate.feedItem.isOverflow) continue;
    const prev = overflowBySource.get(candidate.sourceId) ?? {
      sourceId: candidate.sourceId,
      sourceName: candidate.sourceName,
      count: 0,
    };
    prev.count += 1;
    overflowBySource.set(candidate.sourceId, prev);
  }

  return {
    visible: allCandidates.map((candidate) => candidate.feedItem),
    recommendedIds: [...recommendedIds],
    rankReasons,
    overflowBySource: [...overflowBySource.values()].sort((a, b) => b.count - a.count),
    rankedAt,
    rankStatus,
    rankModel,
  };
}

/**
 * Pull any new newsletter mail into the DB, then serve from the DB. A sync
 * failure must not blank the inbox, but it is logged loudly rather than
 * swallowed.
 */
async function getNewsletterItems(userId: string, accessToken: string | undefined) {
  try {
    await syncNewsletters(userId, accessToken);
  } catch (error) {
    console.error("[rss-inbox] newsletter sync failed; serving stored issues", error);
  }
  return getStoredNewsletterFeed(userId);
}

const COVERAGE_WINDOW_DAYS = 4;

/**
 * Mark RSS stories that a recent newsletter already covered, so Today can
 * fold them. Failure here only loses the folding, so it logs and moves on.
 */
async function markCoveredStories(userId: string, items: FeedItem[]) {
  const stories = items.filter((it) => it.sourceKind === "rss");
  if (stories.length === 0) return;
  try {
    const issues = await prisma.newsletterIssue.findMany({
      where: { userId, receivedAt: { gte: new Date(Date.now() - COVERAGE_WINDOW_DAYS * 86_400_000) } },
      select: { gmailMessageId: true, fromName: true, subject: true, html: true, text: true },
      orderBy: { receivedAt: "desc" },
      take: 40,
    });
    const sources: CoverageSource[] = issues.map((issue) => ({
      id: issue.gmailMessageId,
      publicationName: issue.fromName,
      subject: issue.subject,
      text: issue.text ?? htmlToPlainText(issue.html ?? ""),
    }));
    for (const story of stories) {
      const coverage = findCoverage(story.subject, sources);
      if (coverage) story.coveredBy = coverage;
    }
  } catch (error) {
    console.error("[rss-inbox] coverage check failed", error);
  }
}

export async function GET(req: Request) {
  const auth = await getUserAndToken();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const selectedSourceId = url.searchParams.get("sourceId");
  const isNewsletterOnly = kind === "newsletters";
  const enableRanking = !isNewsletterOnly;
  const requestTag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  // Saved web links only belong in the combined (Today) view.
  const includeWeb = !kind && !selectedSourceId;
  const [gmailItems, rss, webItems] = await Promise.all([
    getNewsletterItems(auth.userId, auth.accessToken),
    getRssFeed(auth.userId, selectedSourceId, enableRanking, requestTag, auth.recommendationCap),
    includeWeb ? getSavedArticleFeed(auth.userId) : Promise.resolve([]),
  ]);

  let items = [...gmailItems, ...rss.visible, ...webItems].sort((a, b) => {
    const ta = new Date(a.date).getTime();
    const tb = new Date(b.date).getTime();
    return tb - ta;
  });
  if (selectedSourceId) items = items.filter((it) => it.sourceId === selectedSourceId);
  if (kind === "rss") items = items.filter((it) => it.sourceKind === "rss");
  if (kind === "newsletters") items = items.filter((it) => it.sourceKind === "gmail");
  if (kind !== "newsletters") await markCoveredStories(auth.userId, items);

  return NextResponse.json({
    items,
    overflowBySource: rss.overflowBySource,
    rssMeta: {
      recommendedIds: rss.recommendedIds,
      rankReasons: rss.rankReasons,
      rankedAt: rss.rankedAt,
      // Lets Today say "Picked by Claude Sonnet, 2h ago" or "not ranked yet"
      // instead of silently showing newest-first when ranking failed.
      rankStatus: rss.rankStatus,
      rankModel: rss.rankModel,
    },
  });
}
