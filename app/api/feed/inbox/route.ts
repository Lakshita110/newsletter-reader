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
  getRssLookbackCutoff,
  getRssLookbackDays,
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

type DayCandidate = {
  sourceId: string;
  sourceName: string;
  cap: number;
  priority: RssPriority;
  item: {
    id: string;
    title: string;
    snippet: string | null;
    author: string | null;
    publishedAt: Date | null;
    createdAt: Date;
  };
  feedItem: FeedItem;
  sortTimeMs: number;
};

const onDemandRankingInFlight = new Map<string, Promise<string[] | null>>();
const LOCK_LEASE_MS = 60_000;
const LOCK_WAIT_MS = 4_000;
const LOCK_POLL_MS = 350;
const FALLBACK_SNAPSHOT_TTL_MS = 45 * 60 * 1000;

function priorityScore(priority: RssPriority): number {
  if (priority === "HIGH") return 3;
  if (priority === "NORMAL") return 2;
  return 1;
}

function extractImageUrl(html?: string | null): string | undefined {
  if (!html) return undefined;
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) return og[1];
  const img = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (img?.[1]) return img[1];
  return undefined;
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
}): Promise<string[] | null> {
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
    if (snapshot.inputFingerprint === inputFingerprint) {
      console.info(
        `[rss-inbox][${requestTag}] ranking snapshot hit day="${dayKey}" status="${snapshot.status}" source="${snapshot.source}" ids=${ids.length}`
      );
      return ids;
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
    return merged;
  }

  const inFlightKey = `${userId}:${dayKey}`;
  const existingInFlight = onDemandRankingInFlight.get(inFlightKey);
  if (existingInFlight) {
    console.info(`[rss-inbox][${requestTag}] waiting for in-process ranking day="${dayKey}"`);
    const ids = await existingInFlight;
    return ids;
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
      return ids;
    }
    console.warn(
      `[rss-inbox][${requestTag}] ranking lock wait timed out day="${dayKey}", using request fallback`
    );
    return null;
  }

  const rankingTask = (async (): Promise<string[] | null> => {
    try {
      const secondCheck = await readValidRankSnapshot(userId, dayKey, new Date());
      if (secondCheck) {
        return idsFromSnapshotJson(secondCheck.rankedItemIds);
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
        await persistRankSnapshot({
          userId,
          dayKey,
          rankedIds,
          status: "AI_SUCCESS",
          source: "ON_DEMAND",
          model: process.env.OPENROUTER_MODEL ?? null,
          inputFingerprint,
          expiresAt: rankSnapshotExpiryUtc(dayKey),
        });
        console.info(
          `[rss-inbox][${requestTag}] ranking snapshot persisted day="${dayKey}" status="AI_SUCCESS" ids=${rankedIds.length}`
        );
        return rankedIds;
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
      return fallbackIds;
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
  const rssLookbackDays = getRssLookbackDays();
  const rssCutoff = getRssLookbackCutoff(rssLookbackDays);
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
                { publishedAt: { gte: rssCutoff } },
                { AND: [{ publishedAt: null }, { createdAt: { gte: rssCutoff } }] },
              ],
            },
            orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
            take: 300,
          },
        },
      },
    },
  });

  const visible: FeedItem[] = [];
  const overflowBySource = new Map<string, { sourceId: string; sourceName: string; count: number }>();
  const rankingCandidatesByDay = new Map<string, DayCandidate[]>();

  for (const sub of subscriptions) {
    const isSelectedSource = selectedSourceId != null && sub.source.id === selectedSourceId;
    const byDay = new Map<string, typeof sub.source.items>();
    for (const item of sub.source.items) {
      const key = dayKeyUtc(item.publishedAt ?? null);
      const list = byDay.get(key) ?? [];
      list.push(item);
      byDay.set(key, list);
    }

    for (const [, dayItems] of byDay) {
      dayItems.sort((a, b) => {
        const ta = a.publishedAt?.getTime() ?? a.createdAt.getTime();
        const tb = b.publishedAt?.getTime() ?? b.createdAt.getTime();
        return tb - ta;
      });

      const cap = isSelectedSource ? Number.POSITIVE_INFINITY : sub.dailyCap;
      const dayKey = dayKeyUtc(dayItems[0]?.publishedAt ?? null);

      for (let i = 0; i < dayItems.length; i++) {
        const item = dayItems[i];
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
          imageUrl: item.imageUrl ?? extractImageUrl(item.htmlRaw),
        };
        const candidates = rankingCandidatesByDay.get(dayKey) ?? [];
        candidates.push({
          sourceId: sub.source.id,
          sourceName: sub.source.name,
          cap,
          priority: sub.priority,
          item: {
            id: item.id,
            title: item.title,
            snippet: item.snippet ?? null,
            author: item.author ?? null,
            publishedAt: item.publishedAt ?? null,
            createdAt: item.createdAt,
          },
          feedItem,
          sortTimeMs: item.publishedAt?.getTime() ?? item.createdAt.getTime(),
        });
        rankingCandidatesByDay.set(dayKey, candidates);
      }
    }
  }

  for (const [dayKey, dayCandidates] of rankingCandidatesByDay) {
    const sortedFallback = [...dayCandidates].sort((a, b) => {
      const pa = priorityScore(a.priority);
      const pb = priorityScore(b.priority);
      if (pa !== pb) return pb - pa;
      return b.sortTimeMs - a.sortTimeMs;
    });

    const capBySource = new Map<string, number>();
    for (const candidate of dayCandidates) {
      if (!capBySource.has(candidate.sourceId)) {
        capBySource.set(candidate.sourceId, candidate.cap);
      }
    }
    const caps = [...capBySource.values()];
    const hasInfiniteCap = caps.some((value) => !Number.isFinite(value));
    const totalCap = caps.reduce((sum, value) => {
      if (!Number.isFinite(value)) return sum;
      if (value <= 0) return sum;
      return sum + value;
    }, 0);

    let selectedIds = new Set<string>();
    const shouldRankThisDay = enableRanking && dayKey === todayDayKey;
    if (enableRanking && !shouldRankThisDay) {
      console.info(
        `[rss-inbox][${requestTag}] ranking skipped for day="${dayKey}" reason="not_today" today="${todayDayKey}"`
      );
    }
    if (shouldRankThisDay) {
      if (totalCap <= 0) {
        selectedIds = new Set();
      } else if (hasInfiniteCap || sortedFallback.length <= totalCap) {
        selectedIds = new Set(sortedFallback.map((candidate) => candidate.feedItem.id));
      } else {
        console.info(
          `[rss-inbox][${requestTag}] ranking requested all-sources day="${dayKey}" items=${sortedFallback.length} cap=${totalCap}`
        );
        const rankedIds = await getOrCreateTodayRankedIds({
          userId,
          dayKey,
          cap: totalCap,
          sortedFallback,
          readProfile: await getReadProfile(),
          requestTag,
        });
        if (rankedIds && rankedIds.length > 0) {
          console.info(
            `[rss-inbox][${requestTag}] ranking applied all-sources day="${dayKey}" selected=${rankedIds.length}`
          );
          selectedIds = selectIdsFromRanked(rankedIds, sortedFallback, totalCap);
        } else {
          console.warn(
            `[rss-inbox][${requestTag}] ranking unavailable, using fallback order all-sources day="${dayKey}"`
          );
          selectedIds = new Set(sortedFallback.slice(0, totalCap).map((candidate) => candidate.feedItem.id));
        }
      }
    } else {
      if (hasInfiniteCap) {
        selectedIds = new Set(sortedFallback.map((candidate) => candidate.feedItem.id));
      } else if (totalCap > 0) {
        selectedIds = new Set(sortedFallback.slice(0, totalCap).map((candidate) => candidate.feedItem.id));
      } else {
        selectedIds = new Set();
      }
    }

    for (const candidate of sortedFallback) {
      if (selectedIds.has(candidate.feedItem.id)) {
        candidate.feedItem.isOverflow = false;
        visible.push(candidate.feedItem);
        continue;
      }
      const prev = overflowBySource.get(candidate.sourceId) ?? {
        sourceId: candidate.sourceId,
        sourceName: candidate.sourceName,
        count: 0,
      };
      prev.count += 1;
      overflowBySource.set(candidate.sourceId, prev);
    }
  }

  return {
    visible,
    overflowBySource: [...overflowBySource.values()].sort((a, b) => b.count - a.count),
  };
}

export async function GET(req: Request) {
  const auth = await getUserAndToken();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const selectedSourceId = url.searchParams.get("sourceId");
  const hasSourceFilter = Boolean(selectedSourceId && selectedSourceId.trim().length > 0);
  const isNewsletterOnly = kind === "newsletters";
  const enableRanking = !hasSourceFilter && !isNewsletterOnly;
  const requestTag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  if (!enableRanking) {
    console.info(
      `[rss-inbox][${requestTag}] ranking disabled due to filters kind="${kind ?? ""}" sourceId="${
        selectedSourceId ?? ""
      }"`
    );
  }

  const [gmailItems, rss] = await Promise.all([
    getGmailFeed(auth.accessToken),
    getRssFeed(auth.userId, selectedSourceId, enableRanking, requestTag),
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
  });
}



