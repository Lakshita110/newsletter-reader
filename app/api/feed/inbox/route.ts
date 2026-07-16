import { google, gmail_v1 } from "googleapis";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { classifyNewsletter, getHeader } from "@/lib/newsletter-classifier";
import { parseFrom, normalizePublicationKey } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { buildRankInputFingerprint, computeDailyRankedSelection } from "@/lib/rss-ranking";
import { normalizeRecommendationPrompt } from "@/lib/rss-recommendation-settings";
import { dayKeyUtc, getUserRssReadProfile, type RssReadProfile } from "@/lib/rss-helpers";
import {
  buildRankingCandidates,
  type AiRankItem as AiItem,
  type FeedItem,
  type RankingCandidate as DayCandidate,
} from "@/lib/rss-candidates";
import { getSessionUser } from "@/lib/session-user";
import {
  FALLBACK_SNAPSHOT_TTL_MS,
  RANK_LOCK_WAIT_MS,
  idsFromSnapshotJson,
  persistRankSnapshot,
  rankSnapshotExpiryUtc,
  readMostRecentSnapshot,
  readValidRankSnapshot,
  releaseRankLock,
  snapshotRankReasons,
  tryAcquireRankLock,
  waitForRankSnapshot,
  type RankSnapshotStatus,
} from "@/lib/rank-snapshot";

type RankedIdsResult = {
  selectedRankIds: string[] | null;
  recommendedRankIds: string[];
  rankReasons: Record<string, string>;
  status: RankSnapshotStatus | null;
  rankingPending: boolean;
  rankedAt: string | null;
};

const onDemandRankingInFlight = new Map<string, Promise<RankedIdsResult>>();
const RANKING_STALENESS_TOLERANCE_MS = 4 * 60 * 60 * 1000; // 4 hours — don't re-rank if snapshot is fresher than this

function selectIdsFromRanked(
  rankedIds: string[],
  sortedFallback: DayCandidate[],
  cap: number
): Set<string> {
  const allowed = new Set(sortedFallback.map((candidate) => candidate.feedItem.id));
  const selected: string[] = [];
  for (const id of rankedIds) {
    if (!allowed.has(id)) continue;
    if (selected.includes(id)) continue;
    selected.push(id);
    if (selected.length >= cap) break;
  }
  if (selected.length < cap) {
    for (const candidate of sortedFallback) {
      if (selected.includes(candidate.feedItem.id)) continue;
      selected.push(candidate.feedItem.id);
      if (selected.length >= cap) break;
    }
  }
  return new Set(selected);
}

function sanitizeRankedIds(
  rankedIds: string[],
  sortedFallback: DayCandidate[],
  cap: number
): string[] {
  const allowed = new Set(sortedFallback.map((candidate) => candidate.feedItem.id));
  const selected: string[] = [];
  for (const id of rankedIds) {
    if (!allowed.has(id)) continue;
    if (selected.includes(id)) continue;
    selected.push(id);
    if (selected.length >= cap) break;
  }
  return selected;
}

function deterministicFallbackIds(sortedFallback: DayCandidate[], cap: number): string[] {
  return sortedFallback.slice(0, cap).map((candidate) => candidate.feedItem.id);
}

/**
 * Recommended-tab membership must never outrun the reasons we can show for
 * it — an id reconstructed from a stored snapshot is only "recommended" if
 * it still has a matching reason today. Shared by every site that derives
 * `recommendedRankIds` from persisted data, so the invariant holds
 * regardless of which read path served the response. Only AI_SUCCESS
 * snapshots ever have recommendations; FALLBACK_DETERMINISTIC is never
 * "recommended".
 */
function deriveRecommendedRankIds(
  ids: string[],
  reasons: Record<string, string>,
  isAiSuccess: boolean,
  sortedFallback: DayCandidate[],
  cap: number
): string[] {
  if (!isAiSuccess) return [];
  return sanitizeRankedIds(ids, sortedFallback, cap).filter((id) => Boolean(reasons[id]));
}

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

function getGmailLookbackDays(): number {
  const raw = Number(process.env.GMAIL_LOOKBACK_DAYS ?? 5);
  if (!Number.isFinite(raw)) return 5;
  return Math.min(30, Math.max(1, Math.floor(raw)));
}

async function getGmailFeed(accessToken?: string): Promise<FeedItem[]> {
  if (!accessToken) return [];
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const lookbackDays = getGmailLookbackDays();
  let messages: gmail_v1.Schema$Message[] = [];
  try {
    const list = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["INBOX"],
      q: `newer_than:${lookbackDays}d -in:chats`,
      maxResults: 100,
    });
    messages = list.data.messages ?? [];
  } catch (error) {
    const status = (error as { code?: number; status?: number; response?: { status?: number } })
      .response?.status ??
      (error as { code?: number; status?: number }).code ??
      (error as { code?: number; status?: number }).status;
    if (status === 401 || status === 403) return [];
    throw error;
  }
  const results = await Promise.all(
    messages.map(async (message) => {
      const id = message.id;
      if (!id) return null;

      const fullMessage = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: [
          "Subject",
          "From",
          "Date",
          "List-Id",
          "List-Unsubscribe",
          "List-Unsubscribe-Post",
          "Precedence",
          "X-List-Id",
          "X-List",
          "Mailing-List",
          "Feedback-ID",
        ],
      });

      const headers = fullMessage.data.payload?.headers;
      const subject = getHeader(headers, "Subject");
      const from = getHeader(headers, "From");
      const date = getHeader(headers, "Date");
      const snippet = fullMessage.data.snippet ?? "";
      const classification = classifyNewsletter(headers, subject, from, snippet);
      if (!classification.isNewsletter) {
        return null;
      }

      const parsed = parseFrom(from);
      const publicationName = parsed.name;
      const publicationKey = normalizePublicationKey(publicationName);

      return {
        id,
        sourceKind: "gmail" as const,
        subject,
        from,
        date,
        snippet,
        publicationName,
        publicationKey,
      };
    })
  );

  return results.filter((x): x is NonNullable<typeof x> => x !== null);
}

async function acquireAndRank(params: {
  userId: string;
  dayKey: string;
  cap: number;
  sortedFallback: DayCandidate[];
  readProfile: RssReadProfile;
  customPrompt: string;
  aiItems: AiItem[];
  requestTag: string;
}): Promise<RankedIdsResult> {
  const { userId, dayKey, cap, sortedFallback, readProfile, customPrompt, aiItems, requestTag } = params;
  const ownerId = randomUUID();
  const lockAcquired = await tryAcquireRankLock(userId, dayKey, ownerId);
  if (!lockAcquired) {
    console.info(`[rss-inbox][${requestTag}] ranking lock busy day="${dayKey}", polling snapshot`);
    const waited = await waitForRankSnapshot(userId, dayKey, RANK_LOCK_WAIT_MS);
    if (waited) {
      const ids = idsFromSnapshotJson(waited.rankedItemIds);
      const waitedReasons = snapshotRankReasons(waited);
      return {
        selectedRankIds: ids,
        recommendedRankIds: deriveRecommendedRankIds(
          ids,
          waitedReasons,
          waited.status === "AI_SUCCESS",
          sortedFallback,
          cap
        ),
        rankReasons: waitedReasons,
        status: waited.status,
        rankingPending: false,
        rankedAt: waited.updatedAt.toISOString(),
      };
    }
    console.warn(`[rss-inbox][${requestTag}] ranking lock wait timed out day="${dayKey}", using request fallback`);
    return { selectedRankIds: null, recommendedRankIds: [], rankReasons: {}, status: null, rankingPending: false, rankedAt: null };
  }

  try {
    const secondCheck = await readValidRankSnapshot(userId, dayKey, new Date());
    if (secondCheck) {
      const ids = idsFromSnapshotJson(secondCheck.rankedItemIds);
      const secondCheckReasons = snapshotRankReasons(secondCheck);
      return {
        selectedRankIds: ids,
        recommendedRankIds: deriveRecommendedRankIds(
          ids,
          secondCheckReasons,
          secondCheck.status === "AI_SUCCESS",
          sortedFallback,
          cap
        ),
        rankReasons: secondCheckReasons,
        status: secondCheck.status,
        rankingPending: false,
        rankedAt: secondCheck.updatedAt.toISOString(),
      };
    }

    const now = new Date();
    const ranking = await computeDailyRankedSelection({
      userId,
      dayKey,
      cap,
      rankedItems: aiItems,
      customPrompt,
      readProfile,
    });
    const isAiSuccess = ranking.status === "AI_SUCCESS";
    const selectedIds = ranking.selectedIds;
    await persistRankSnapshot({
      userId,
      dayKey,
      rankedIds: selectedIds,
      rankReasons: ranking.rankReasons,
      status: ranking.status,
      source: "ON_DEMAND",
      model: ranking.model,
      inputFingerprint: ranking.inputFingerprint,
      expiresAt: isAiSuccess ? rankSnapshotExpiryUtc(dayKey) : new Date(Date.now() + FALLBACK_SNAPSHOT_TTL_MS),
    });
    console.info(
      `[rss-inbox][${requestTag}] ranking snapshot persisted day="${dayKey}" status="${ranking.status}" ids=${selectedIds.length}`
    );
    return {
      selectedRankIds: selectedIds,
      recommendedRankIds: ranking.recommendedIds,
      rankReasons: ranking.rankReasons,
      status: ranking.status,
      rankingPending: false,
      rankedAt: now.toISOString(),
    };
  } finally {
    await releaseRankLock(userId, dayKey, ownerId);
  }
}

async function getOrCreateTodayRankedIds(params: {
  userId: string;
  dayKey: string;
  cap: number;
  sortedFallback: DayCandidate[];
  aiItems: AiItem[];
  readProfile: RssReadProfile;
  requestTag: string;
}): Promise<RankedIdsResult> {
  const { userId, dayKey, cap, sortedFallback, aiItems, readProfile, requestTag } = params;
  const normalizedPrompt = readProfile.customPrompt ?? "";
  const inputFingerprint = buildRankInputFingerprint(dayKey, cap, normalizedPrompt, aiItems);
  const rankParams = {
    userId,
    dayKey,
    cap,
    sortedFallback,
    aiItems,
    readProfile,
    customPrompt: normalizedPrompt,
    requestTag,
  };

  const snapshot = await readValidRankSnapshot(userId, dayKey, new Date());
  if (snapshot) {
    const ids = idsFromSnapshotJson(snapshot.rankedItemIds);
    const rankedAt = snapshot.updatedAt.toISOString();
    const snapshotReasons = snapshotRankReasons(snapshot);
    const recommendedRankIds = deriveRecommendedRankIds(
      ids,
      snapshotReasons,
      snapshot.status === "AI_SUCCESS",
      sortedFallback,
      cap
    );
    if (snapshot.inputFingerprint === inputFingerprint) {
      console.info(`[rss-inbox][${requestTag}] ranking snapshot hit day="${dayKey}" status="${snapshot.status}" source="${snapshot.source}" ids=${ids.length}`);
      return { selectedRankIds: ids, recommendedRankIds, rankReasons: snapshotReasons, status: snapshot.status, rankingPending: false, rankedAt };
    }

    // Stale fingerprint — only re-rank if snapshot is older than the staleness tolerance
    const snapshotAgeMs = Date.now() - snapshot.updatedAt.getTime();
    if (snapshotAgeMs < RANKING_STALENESS_TOLERANCE_MS) {
      console.info(`[rss-inbox][${requestTag}] ranking snapshot stale-input but fresh enough (${Math.round(snapshotAgeMs / 60000)}m old) day="${dayKey}" — serving as-is`);
      return { selectedRankIds: ids, recommendedRankIds, rankReasons: snapshotReasons, status: snapshot.status, rankingPending: false, rankedAt };
    }

    console.info(`[rss-inbox][${requestTag}] ranking snapshot stale-input and old (${Math.round(snapshotAgeMs / 60000)}m) day="${dayKey}" — background re-rank`);
    await prisma.userRssDailyRankSnapshot.delete({ where: { userId_dayKey: { userId, dayKey } } }).catch(() => null);

    const inFlightKey = `${userId}:${dayKey}`;
    if (!onDemandRankingInFlight.has(inFlightKey)) {
      const bgTask = acquireAndRank(rankParams);
      onDemandRankingInFlight.set(inFlightKey, bgTask);
      bgTask.finally(() => onDemandRankingInFlight.delete(inFlightKey)).catch(() => null);
    }
    return {
      selectedRankIds: deterministicFallbackIds(sortedFallback, cap),
      recommendedRankIds: [],
      rankReasons: {},
      status: "FALLBACK_DETERMINISTIC",
      rankingPending: true,
      rankedAt,
    };
  }

  // No snapshot for today — serve the most recent prior ranking instantly and
  // rank today's in the background. The client polls every 3s while
  // rankingPending is true and swaps in today's ranking once it lands, so the
  // request never blocks on OpenRouter. This is the morning cold-start path:
  // before this, the first open of the UTC day awaited a live rank (several
  // seconds); now it shows yesterday's ranking immediately.
  const inFlightKey = `${userId}:${dayKey}`;
  if (!onDemandRankingInFlight.has(inFlightKey)) {
    const bgTask = acquireAndRank(rankParams);
    onDemandRankingInFlight.set(inFlightKey, bgTask);
    bgTask.finally(() => onDemandRankingInFlight.delete(inFlightKey)).catch(() => null);
  }

  const prior = await readMostRecentSnapshot(userId);
  const priorIds = prior ? idsFromSnapshotJson(prior.rankedItemIds) : [];
  const priorIsAi = prior?.status === "AI_SUCCESS";
  const priorReasons = priorIsAi ? snapshotRankReasons(prior) : {};
  console.info(
    `[rss-inbox][${requestTag}] cold start day="${dayKey}" — serving ${priorIds.length > 0 ? `prior snapshot day="${prior?.dayKey ?? "?"}"` : "deterministic order"} while background rank runs`
  );
  return {
    selectedRankIds: priorIds.length > 0 ? priorIds : deterministicFallbackIds(sortedFallback, cap),
    recommendedRankIds: deriveRecommendedRankIds(priorIds, priorReasons, Boolean(priorIsAi), sortedFallback, cap),
    rankReasons: priorReasons,
    status: "FALLBACK_DETERMINISTIC",
    rankingPending: true,
    rankedAt: prior ? prior.updatedAt.toISOString() : null,
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
      selectedIds = selectIdsFromRanked(rankingResult.selectedRankIds, sortedFallback, totalCap);
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
