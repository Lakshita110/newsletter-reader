import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeRecommendationPrompt } from "@/lib/rss-recommendation-settings";
import { dayKeyUtc } from "@/lib/rss-helpers";
import { getUserRssReadProfile, type RssReadProfile } from "@/lib/rss-read-profile";
import { buildRankingCandidates } from "@/lib/rss-candidates";
import { getGmailFeed } from "@/lib/gmail-feed";
import { getSessionUser } from "@/lib/session-user";
import { getOrCreateTodayRankedIds, selectRankedIds } from "@/lib/rank-snapshot";

export const dynamic = "force-dynamic";

async function getUserAndToken() {
  const auth = await getSessionUser();
  if (!auth) return null;
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: auth.userId },
    select: { rssRecommendationCap: true, rssRecommendationPrompt: true },
  });
  return {
    userId: auth.userId,
    accessToken: auth.accessToken,
    recommendationCap: user.rssRecommendationCap,
    recommendationPrompt: user.rssRecommendationPrompt,
  };
}

async function getRssFeed(
  userId: string,
  selectedSourceId?: string | null,
  enableRanking: boolean = true,
  requestTag: string = "req",
  recommendationCap?: number | null,
  recommendationPrompt?: string | null
) {
  let readProfilePromise: Promise<RssReadProfile> | null = null;
  const getReadProfile = async () => {
    if (!readProfilePromise) {
      readProfilePromise = getUserRssReadProfile(userId);
    }
    return readProfilePromise;
  };
  const todayDayKey = dayKeyUtc(new Date());

  const overflowBySource = new Map<string, { sourceId: string; sourceName: string; count: number }>();
  const { allCandidates, sortedFallback, aiItems, totalCap } = await buildRankingCandidates({
    userId,
    selectedSourceId,
    recommendationCap,
  });

  let selectedIds = new Set<string>();
  let recommendedIds = new Set<string>();
  let rankReasons: Record<string, string> = {};
  let rankingPending = false;
  let rankedAt: string | null = null;
  if (totalCap <= 0) {
    selectedIds = new Set();
  } else if (!enableRanking) {
    selectedIds = new Set(sortedFallback.slice(0, totalCap).map((candidate) => candidate.feedItem.id));
  } else {
    console.info(
      `[rss-inbox][${requestTag}] ranking requested rolling24h day="${todayDayKey}" items=${sortedFallback.length} cap=${totalCap}`
    );
    const rankingResult = await getOrCreateTodayRankedIds({
      userId,
      dayKey: todayDayKey,
      cap: totalCap,
      sortedFallback,
      aiItems,
      readProfile: {
        ...(await getReadProfile()),
        customPrompt: normalizeRecommendationPrompt(recommendationPrompt),
      },
      requestTag,
    });
    rankingPending = rankingResult.rankingPending;
    rankedAt = rankingResult.rankedAt;
    rankReasons = rankingResult.rankReasons;
    recommendedIds = new Set(rankingResult.recommendedRankIds);
    if (rankingResult.selectedRankIds && rankingResult.selectedRankIds.length > 0) {
      console.info(
        `[rss-inbox][${requestTag}] ranking applied rolling24h day="${todayDayKey}" selected=${rankingResult.selectedRankIds.length} recommended=${rankingResult.recommendedRankIds.length} status="${rankingResult.status ?? "NONE"}"`
      );
      selectedIds = new Set(
        selectRankedIds(rankingResult.selectedRankIds, sortedFallback, totalCap, { backfill: true })
      );
    } else {
      console.warn(
        `[rss-inbox][${requestTag}] ranking unavailable, using fallback rolling24h day="${todayDayKey}"`
      );
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
    rankingPending,
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
  if (!enableRanking) {
    console.info(
      `[rss-inbox][${requestTag}] ranking disabled due to kind="${kind ?? ""}"`
    );
  }

  const [gmailItems, rss] = await Promise.all([
    getGmailFeed(auth.accessToken),
    getRssFeed(
      auth.userId,
      selectedSourceId,
      enableRanking,
      requestTag,
      auth.recommendationCap,
      auth.recommendationPrompt
    ),
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
      rankingPending: rss.rankingPending,
      rankedAt: rss.rankedAt,
    },
  });
}
