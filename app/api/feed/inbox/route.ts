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
import { getGmailAccessToken } from "@/lib/gmail-token";

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
    accessToken: (await getGmailAccessToken(sessionUser.userId)) ?? undefined,
    recommendationCap: user.rssRecommendationCap,
  };
}

/**
 * The ranked pool for Today: every candidate from the last day (plus a week of
 * newsletters), with the latest ranking applied. Stories outside the day's
 * picks are flagged `isOverflow` so Today can show only a few of them.
 */
async function getRankedFeed(userId: string, recommendationCap: number | null) {
  const { allCandidates, sortedFallback, totalCap } = await buildRankingCandidates({ userId, recommendationCap });

  let selectedIds = new Set<string>();
  let recommendedIds: string[] = [];
  let rankedAt: string | null = null;
  let rankStatus: string | null = null;
  let rankModel: string | null = null;
  if (totalCap > 0) {
    const ranking = await getLatestRankedIds({ userId, sortedFallback, cap: totalCap });
    rankedAt = ranking.rankedAt;
    rankStatus = ranking.status;
    rankModel = modelLabel(ranking.model);
    recommendedIds = ranking.recommendedRankIds;
    if (ranking.selectedRankIds && ranking.selectedRankIds.length > 0) {
      selectedIds = new Set(selectRankedIds(ranking.selectedRankIds, sortedFallback, totalCap, { backfill: true }));
    } else {
      console.info("[feed] no ranking yet, using newest-first");
      selectedIds = new Set(sortedFallback.slice(0, totalCap).map((candidate) => candidate.feedItem.id));
    }
  }

  for (const candidate of sortedFallback) {
    // Newsletters are in the ranking pool too, but they are never hidden as
    // "overflow": she subscribed to every one of them. Ranking only orders them.
    if (candidate.feedItem.sourceKind === "gmail") continue;
    candidate.feedItem.isOverflow = !selectedIds.has(candidate.feedItem.id);
  }

  return {
    visible: allCandidates.map((candidate) => candidate.feedItem),
    recommendedIds,
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

export async function GET() {
  const auth = await getUserAndToken();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [gmailItems, ranked, webItems] = await Promise.all([
    getNewsletterItems(auth.userId, auth.accessToken),
    getRankedFeed(auth.userId, auth.recommendationCap),
    getSavedArticleFeed(auth.userId),
  ]);

  // Recent newsletters arrive twice (the stored-issue list and the ranking
  // pool); keep the first copy of each id.
  const seen = new Set<string>();
  const items = [...gmailItems, ...ranked.visible, ...webItems]
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  await markCoveredStories(auth.userId, items);

  return NextResponse.json({
    items,
    rssMeta: {
      recommendedIds: ranked.recommendedIds,
      rankedAt: ranked.rankedAt,
      // Lets Today say "Picked by GPT-5 mini, 2h ago" or "not ranked yet"
      // instead of silently showing newest-first when ranking failed.
      rankStatus: ranked.rankStatus,
      rankModel: ranked.rankModel,
    },
  });
}
