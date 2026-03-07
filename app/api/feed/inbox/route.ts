import { google, gmail_v1 } from "googleapis";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import { authOptions } from "@/lib/auth";
import { classifyNewsletter, getHeader } from "@/lib/newsletter-classifier";
import { parseFrom, normalizePublicationKey } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { normalizeRssCategory } from "@/lib/rss-categories";
import { rankItemsForDailyCap } from "@/lib/rss-daily-cap-ranker";
import {
  dayKeyUtc,
  extractImageUrlFromHtml,
  getRssDailyTargetCap,
  getUserRssReadProfile,
  type RssReadProfile,
} from "@/lib/rss-helpers";
type RssPriority = "HIGH" | "NORMAL" | "LOW";

type FeedItem = {
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

type RankSnapshotStatus = "AI_SUCCESS" | "FALLBACK_DETERMINISTIC";
type RankSnapshotSource = "CRON" | "ON_DEMAND";
type RankedIdsResult = {
  selectedRankIds: string[] | null;
  recommendedRankIds: string[];
  status: RankSnapshotStatus | null;
};

type DayCandidate = {
  sourceId: string;
  sourceName: string;
  priority: RssPriority;
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

const onDemandRankingInFlight = new Map<string, Promise<RankedIdsResult>>();
const LOCK_LEASE_MS = 60_000;
const LOCK_WAIT_MS = 4_000;
const LOCK_POLL_MS = 350;
const FALLBACK_SNAPSHOT_TTL_MS = 45 * 60 * 1000;

function priorityScore(priority: RssPriority): number {
  if (priority === "HIGH") return 3;
  if (priority === "NORMAL") return 2;
  return 1;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildRankInputFingerprint(dayKey: string, cap: number, items: Array<{ id: string }>): string {
  const payload = `${dayKey}|${cap}|${items.map((item) => item.id).join(",")}`;
  return createHash("sha256").update(payload).digest("hex");
}

function rankSnapshotExpiryUtc(dayKey: string): Date {
  const nextDay = new Date(`${dayKey}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return nextDay;
}

function idsFromSnapshotJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string");
}

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

async function readValidRankSnapshot(userId: string, dayKey: string, now: Date) {
  return prisma.userRssDailyRankSnapshot.findFirst({
    where: { userId, dayKey, expiresAt: { gt: now } },
    orderBy: { updatedAt: "desc" },
  });
}

async function persistRankSnapshot(args: {
  userId: string;
  dayKey: string;
  rankedIds: string[];
  status: RankSnapshotStatus;
  source: RankSnapshotSource;
  model?: string | null;
  inputFingerprint: string;
  expiresAt: Date;
}) {
  await prisma.userRssDailyRankSnapshot.upsert({
    where: { userId_dayKey: { userId: args.userId, dayKey: args.dayKey } },
    update: {
      rankedItemIds: args.rankedIds,
      status: args.status,
      source: args.source,
      model: args.model ?? null,
      inputFingerprint: args.inputFingerprint,
      expiresAt: args.expiresAt,
    },
    create: {
      userId: args.userId,
      dayKey: args.dayKey,
      rankedItemIds: args.rankedIds,
      status: args.status,
      source: args.source,
      model: args.model ?? null,
      inputFingerprint: args.inputFingerprint,
      expiresAt: args.expiresAt,
    },
  });
}

async function tryAcquireRankLock(userId: string, dayKey: string, ownerId: string): Promise<boolean> {
  const now = new Date();
  await prisma.userRssRankJobLock.deleteMany({
    where: { userId, dayKey, expiresAt: { lte: now } },
  });
  try {
    await prisma.userRssRankJobLock.create({
      data: {
        userId,
        dayKey,
        ownerId,
        expiresAt: new Date(now.getTime() + LOCK_LEASE_MS),
      },
    });
    return true;
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "P2002") return false;
    throw error;
  }
}

async function releaseRankLock(userId: string, dayKey: string, ownerId: string): Promise<void> {
  await prisma.userRssRankJobLock.deleteMany({
    where: { userId, dayKey, ownerId },
  });
}

async function waitForRankSnapshot(userId: string, dayKey: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await readValidRankSnapshot(userId, dayKey, new Date());
    if (snapshot) return snapshot;
    await sleep(LOCK_POLL_MS);
  }
  return null;
}

function deterministicFallbackIds(sortedFallback: DayCandidate[], cap: number): string[] {
  return sortedFallback.slice(0, cap).map((candidate) => candidate.feedItem.id);
}

async function getUserAndToken() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
    select: { id: true },
  });
  return {
    userId: user.id,
    accessToken: session?.accessToken as string | undefined,
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

async function getOrCreateTodayRankedIds(params: {
  userId: string;
  dayKey: string;
  cap: number;
  sortedFallback: DayCandidate[];
  readProfile: RssReadProfile;
  requestTag: string;
}): Promise<RankedIdsResult> {
  const { userId, dayKey, cap, sortedFallback, readProfile, requestTag } = params;
  const aiItems = sortedFallback.map((candidate) => ({
    id: candidate.feedItem.id,
    title: candidate.item.title,
    snippet: candidate.item.snippet ?? "",
    author: candidate.item.author ?? null,
    publishedAtIso: (candidate.item.publishedAt ?? candidate.item.createdAt).toISOString(),
  }));
  const inputFingerprint = buildRankInputFingerprint(dayKey, cap, aiItems);
  const now = new Date();
  const snapshot = await readValidRankSnapshot(userId, dayKey, now);
  if (snapshot) {
    const ids = idsFromSnapshotJson(snapshot.rankedItemIds);
    const recommendedRankIds =
      snapshot.status === "AI_SUCCESS" ? sanitizeRankedIds(ids, sortedFallback, cap) : [];
    if (snapshot.inputFingerprint === inputFingerprint) {
      console.info(
        `[rss-inbox][${requestTag}] ranking snapshot hit day="${dayKey}" status="${snapshot.status}" source="${snapshot.source}" ids=${ids.length}`
      );
      return {
        selectedRankIds: ids,
        recommendedRankIds,
        status: snapshot.status,
      };
    }
    const fallbackOrderedIds = sortedFallback.map((candidate) => candidate.feedItem.id);
    const snapshotSet = new Set(ids);
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const id of fallbackOrderedIds) {
      if (snapshotSet.has(id)) continue;
      if (seen.has(id)) continue;
      merged.push(id);
      seen.add(id);
    }
    for (const id of ids) {
      if (seen.has(id)) continue;
      merged.push(id);
      seen.add(id);
    }
    for (const id of fallbackOrderedIds) {
      if (seen.has(id)) continue;
      merged.push(id);
      seen.add(id);
    }
    console.info(
      `[rss-inbox][${requestTag}] ranking snapshot stale-input day="${dayKey}" status="${snapshot.status}" source="${snapshot.source}" existingIds=${ids.length} mergedIds=${merged.length}`
    );
    return {
      selectedRankIds: merged,
      recommendedRankIds,
      status: snapshot.status,
    };
  }

  const inFlightKey = `${userId}:${dayKey}`;
  const existingInFlight = onDemandRankingInFlight.get(inFlightKey);
  if (existingInFlight) {
    console.info(`[rss-inbox][${requestTag}] waiting for in-process ranking day="${dayKey}"`);
    return await existingInFlight;
  }

  const ownerId = randomUUID();
  const lockAcquired = await tryAcquireRankLock(userId, dayKey, ownerId);
  if (!lockAcquired) {
    console.info(`[rss-inbox][${requestTag}] ranking lock busy day="${dayKey}", polling snapshot`);
    const waited = await waitForRankSnapshot(userId, dayKey, LOCK_WAIT_MS);
    if (waited) {
      const ids = idsFromSnapshotJson(waited.rankedItemIds);
      console.info(
        `[rss-inbox][${requestTag}] ranking snapshot arrived after wait day="${dayKey}" ids=${ids.length}`
      );
      return {
        selectedRankIds: ids,
        recommendedRankIds:
          waited.status === "AI_SUCCESS" ? sanitizeRankedIds(ids, sortedFallback, cap) : [],
        status: waited.status,
      };
    }
    console.warn(
      `[rss-inbox][${requestTag}] ranking lock wait timed out day="${dayKey}", using request fallback`
    );
    return {
      selectedRankIds: null,
      recommendedRankIds: [],
      status: null,
    };
  }

  const rankingTask = (async (): Promise<RankedIdsResult> => {
    try {
      const secondCheck = await readValidRankSnapshot(userId, dayKey, new Date());
      if (secondCheck) {
        const ids = idsFromSnapshotJson(secondCheck.rankedItemIds);
        return {
          selectedRankIds: ids,
          recommendedRankIds:
            secondCheck.status === "AI_SUCCESS" ? sanitizeRankedIds(ids, sortedFallback, cap) : [],
          status: secondCheck.status,
        };
      }
      const rankedIds = await rankItemsForDailyCap({
        sourceName: "All RSS Sources",
        dayKey,
        category: "mixed",
        cap,
        userProfile: readProfile,
        items: aiItems,
      }).catch((error) => {
        console.error(
          `[rss-inbox][${requestTag}] rankItemsForDailyCap threw for on-demand day="${dayKey}"`,
          error
        );
        return null;
      });

      if (rankedIds && rankedIds.length > 0) {
        const normalizedIds = sanitizeRankedIds(rankedIds, sortedFallback, cap);
        await persistRankSnapshot({
          userId,
          dayKey,
          rankedIds: normalizedIds,
          status: "AI_SUCCESS",
          source: "ON_DEMAND",
          model: process.env.OPENROUTER_MODEL ?? null,
          inputFingerprint,
          expiresAt: rankSnapshotExpiryUtc(dayKey),
        });
        console.info(
          `[rss-inbox][${requestTag}] ranking snapshot persisted day="${dayKey}" status="AI_SUCCESS" ids=${normalizedIds.length}`
        );
        return {
          selectedRankIds: normalizedIds,
          recommendedRankIds: normalizedIds,
          status: "AI_SUCCESS",
        };
      }

      const fallbackIds = deterministicFallbackIds(sortedFallback, cap);
      await persistRankSnapshot({
        userId,
        dayKey,
        rankedIds: fallbackIds,
        status: "FALLBACK_DETERMINISTIC",
        source: "ON_DEMAND",
        model: process.env.OPENROUTER_MODEL ?? null,
        inputFingerprint,
        expiresAt: new Date(Date.now() + FALLBACK_SNAPSHOT_TTL_MS),
      });
      console.warn(
        `[rss-inbox][${requestTag}] ranking snapshot persisted day="${dayKey}" status="FALLBACK_DETERMINISTIC" ids=${fallbackIds.length}`
      );
      return {
        selectedRankIds: fallbackIds,
        recommendedRankIds: [],
        status: "FALLBACK_DETERMINISTIC",
      };
    } finally {
      await releaseRankLock(userId, dayKey, ownerId);
    }
  })();

  onDemandRankingInFlight.set(inFlightKey, rankingTask);
  try {
    return await rankingTask;
  } finally {
    onDemandRankingInFlight.delete(inFlightKey);
  }
}

async function getRssFeed(
  userId: string,
  selectedSourceId?: string | null,
  enableRanking: boolean = true,
  requestTag: string = "req"
) {
  const rollingCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let readProfilePromise: Promise<RssReadProfile> | null = null;
  const getReadProfile = async () => {
    if (!readProfilePromise) {
      readProfilePromise = getUserRssReadProfile(userId);
    }
    return readProfilePromise;
  };
  const todayDayKey = dayKeyUtc(new Date());
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

  const overflowBySource = new Map<string, { sourceId: string; sourceName: string; count: number }>();
  const allCandidates: DayCandidate[] = [];

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
        priority: sub.priority,
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
  const unreadCandidates = allCandidates.filter((candidate) => !readIdSet.has(candidate.feedItem.id));

  const sortedFallback = unreadCandidates.sort((a, b) => {
    const pa = priorityScore(a.priority);
    const pb = priorityScore(b.priority);
    if (pa !== pb) return pb - pa;
    return b.sortTimeMs - a.sortTimeMs;
  });

  const totalCap = getRssDailyTargetCap(sortedFallback.length);
  let selectedIds = new Set<string>();
  let recommendedIds = new Set<string>();
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
      readProfile: await getReadProfile(),
      requestTag,
    });
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
    overflowBySource: [...overflowBySource.values()].sort((a, b) => b.count - a.count),
  };
}

async function getRssFreshSyncStatus(userId: string, selectedSourceId?: string | null): Promise<boolean> {
  const latestCronSnapshot = await prisma.userRssDailyRankSnapshot.findFirst({
    where: {
      userId,
      source: "CRON",
    },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });

  if (!latestCronSnapshot) return false;

  const newestItem = await prisma.rssItem.findFirst({
    where: {
      source: {
        subscriptions: {
          some: {
            userId,
            isActive: true,
            ...(selectedSourceId ? { rssSourceId: selectedSourceId } : {}),
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  if (!newestItem) return false;
  return newestItem.createdAt > latestCronSnapshot.updatedAt;
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

  const [gmailItems, rss, hasFreshSyncItems] = await Promise.all([
    getGmailFeed(auth.accessToken),
    getRssFeed(auth.userId, selectedSourceId, enableRanking, requestTag),
    getRssFreshSyncStatus(auth.userId, selectedSourceId),
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
      hasFreshSyncItems,
      recommendedIds: rss.recommendedIds,
    },
  });
}



