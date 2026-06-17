import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeDailyRankedSelection } from "@/lib/rss-ranking";
import { runAndPersistRankEval } from "@/lib/rss-rank-eval";
import {
  buildRssArticleDedupKey,
  dedupeByArticleKey,
  dayKeyUtc,
  getRssDailyTargetCap,
  getUserRssReadProfile,
  rssPriorityScore,
  sortByPriorityAndRecency,
} from "@/lib/rss-helpers";
import { normalizeRecommendationPrompt } from "@/lib/rss-recommendation-settings";

export const dynamic = "force-dynamic";

type RssPriority = "HIGH" | "NORMAL" | "LOW";

function isAuthorized(req: Request): boolean {
  const configured = process.env.CRON_SECRET;
  if (!configured) return false;
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return bearer === configured || (req.headers.get("x-cron-secret") ?? "") === configured;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const dayKeyParam = url.searchParams.get("dayKey");
  if (dayKeyParam && !/^\d{4}-\d{2}-\d{2}$/.test(dayKeyParam)) {
    return NextResponse.json({ error: "dayKey must be YYYY-MM-DD" }, { status: 400 });
  }
  const dayKey = dayKeyParam ?? dayKeyUtc(new Date());

  const capParam = url.searchParams.get("cap");
  const capOverride =
    capParam && Number.isFinite(Number(capParam)) && Number(capParam) > 0
      ? Math.floor(Number(capParam))
      : null;

  const runEval = url.searchParams.get("eval") === "true";

  const userSettings = await prisma.user.findUnique({
    where: { id: userId },
    select: { rssRecommendationPrompt: true },
  });
  const customPrompt =
    normalizeRecommendationPrompt(userSettings?.rssRecommendationPrompt) ?? "";

  const rollingCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
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

  type Candidate = {
    id: string;
    sourceName: string;
    dedupKey: string;
    priority: RssPriority;
    sortTimeMs: number;
    title: string;
    snippet: string;
    author: string | null;
    publishedAtIso: string;
  };

  const candidates: Candidate[] = [];
  for (const sub of subscriptions) {
    for (const item of sub.source.items) {
      candidates.push({
        id: `rss:${item.id}`,
        sourceName: sub.source.name,
        dedupKey: buildRssArticleDedupKey({
          externalUrl: item.link,
          title: item.title,
          snippet: item.snippet ?? "",
        }),
        priority: sub.priority,
        sortTimeMs: item.publishedAt?.getTime() ?? item.createdAt.getTime(),
        title: item.title,
        snippet: item.snippet ?? "",
        author: item.author ?? null,
        publishedAtIso: (item.publishedAt ?? item.createdAt).toISOString(),
      });
    }
  }

  const candidateIds = candidates.map((c) => c.id);
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
  const readIdSet = new Set(readRows.map((r) => r.messageExternalId));
  const unread = candidates.filter((c) => !readIdSet.has(c.id));
  const deduped = dedupeByArticleKey(
    unread,
    (c) => rssPriorityScore(c.priority),
    (c) => c.sortTimeMs
  );
  const sorted = sortByPriorityAndRecency(
    deduped,
    (c) => c.priority,
    (c) => c.sortTimeMs
  );

  const cap = capOverride ?? getRssDailyTargetCap(sorted.length);
  const aiItems = sorted.map((c) => ({
    id: c.id,
    title: c.title,
    snippet: c.snippet,
    author: c.author,
    sourceName: c.sourceName,
    publishedAtIso: c.publishedAtIso,
  }));

  const readProfile = await getUserRssReadProfile(userId);
  const ranking = await computeDailyRankedSelection({
    userId,
    dayKey,
    cap,
    rankedItems: aiItems,
    customPrompt,
    readProfile,
  });

  const byId = new Map(aiItems.map((item) => [item.id, item]));
  const sourceDistribution: Record<string, number> = {};
  const selectedItems = ranking.selectedIds.map((id) => {
    const item = byId.get(id);
    const src = item?.sourceName ?? "unknown";
    sourceDistribution[src] = (sourceDistribution[src] ?? 0) + 1;
    return {
      id,
      title: item?.title ?? "",
      sourceName: src,
      snippet: (item?.snippet ?? "").slice(0, 120),
      publishedAtIso: item?.publishedAtIso ?? "",
    };
  });

  let evalResult: unknown = undefined;
  if (runEval && aiItems.length > 0) {
    try {
      const selectedEvalItems = ranking.selectedIds
        .map((id) => byId.get(id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .map((item) => ({ id: item.id, title: item.title, sourceName: item.sourceName, snippet: item.snippet }));
      evalResult = await runAndPersistRankEval({
        userId,
        dayKey,
        selectedItems: selectedEvalItems,
        candidateItems: aiItems.map((item) => ({ id: item.id, title: item.title, sourceName: item.sourceName, snippet: item.snippet })),
        userProfileSummary: readProfile.preferenceSummary.join("; "),
        cap,
        source: "ON_DEMAND",
      });
    } catch (err) {
      evalResult = { error: err instanceof Error ? err.message : "eval failed" };
    }
  }

  return NextResponse.json({
    ok: true,
    dayKey,
    userId,
    candidateCount: aiItems.length,
    cap,
    rankingStatus: ranking.status,
    selectedItems,
    sourceDistribution,
    ...(runEval ? { eval: evalResult } : {}),
  });
}

export async function POST(req: Request) {
  return GET(req);
}
