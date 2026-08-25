import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildRankingCandidates } from "@/lib/rss-candidates";
import { getGmailFeed } from "@/lib/gmail-feed";
import { getSessionUser } from "@/lib/session-user";
import { getLatestRankedIds, selectRankedIds } from "@/lib/rank-snapshot";

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
    // getGmailFeed() handles a missing token on its own. RSS items don't
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
  if (totalCap <= 0) {
    selectedIds = new Set();
  } else if (!enableRanking) {
    selectedIds = new Set(sortedFallback.slice(0, totalCap).map((candidate) => candidate.feedItem.id));
  } else {
    const rankingResult = await getLatestRankedIds({ userId, sortedFallback, cap: totalCap });
    rankedAt = rankingResult.rankedAt;
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
  };
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

  const [gmailItems, rss] = await Promise.all([
    getGmailFeed(auth.accessToken),
    getRssFeed(auth.userId, selectedSourceId, enableRanking, requestTag, auth.recommendationCap),
  ]);

  let items = [...gmailItems, ...rss.visible].sort((a, b) => {
    const ta = new Date(a.date).getTime();
    const tb = new Date(b.date).getTime();
    return tb - ta;
  });
  if (selectedSourceId) items = items.filter((it) => it.sourceId === selectedSourceId);
  if (kind === "rss") items = items.filter((it) => it.sourceKind === "rss");
  if (kind === "newsletters") items = items.filter((it) => it.sourceKind === "gmail");

  return NextResponse.json({
    items,
    overflowBySource: rss.overflowBySource,
    rssMeta: {
      recommendedIds: rss.recommendedIds,
      rankReasons: rss.rankReasons,
      rankedAt: rss.rankedAt,
    },
  });
}
