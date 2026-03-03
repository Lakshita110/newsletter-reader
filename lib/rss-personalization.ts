import { prisma } from "@/lib/prisma";

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
  isOverflow?: boolean;
  externalUrl?: string;
  imageUrl?: string;
};

type UserSourceStats = {
  sourceId: string;
  totalOpened: number;
  completed: number;
  inProgress: number;
  avgCompletionPct: number;
  lastOpenedAt?: string;
};

type LlmRanking = {
  id: string;
  score?: number;
  include?: boolean;
};

const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const PERSONALIZATION_MODEL = process.env.RSS_PERSONALIZATION_MODEL ?? "gpt-5-nano";

function parseJsonObject(text: string): { ranking?: LlmRanking[] } | null {
  try {
    return JSON.parse(text) as { ranking?: LlmRanking[] };
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as { ranking?: LlmRanking[] };
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function getUserRssStats(userId: string, sourceIds: string[]): Promise<UserSourceStats[]> {
  if (sourceIds.length === 0) return [];

  const readRows = await prisma.messageReadStat.findMany({
    where: {
      userId,
      messageExternalId: { startsWith: "rss:" },
    },
    select: {
      messageExternalId: true,
      completionPct: true,
      completedAt: true,
      lastOpenedAt: true,
    },
    orderBy: { lastOpenedAt: "desc" },
    take: 500,
  });

  const itemIds = readRows
    .map((row) => row.messageExternalId.replace(/^rss:/, ""))
    .filter((id) => id.length > 0);

  if (itemIds.length === 0) return [];

  const rssItems = await prisma.rssItem.findMany({
    where: {
      id: { in: itemIds },
      rssSourceId: { in: sourceIds },
    },
    select: {
      id: true,
      rssSourceId: true,
    },
  });

  const sourceByItemId = new Map(rssItems.map((item) => [item.id, item.rssSourceId]));
  const statsMap = new Map<string, UserSourceStats>();

  for (const row of readRows) {
    const itemId = row.messageExternalId.replace(/^rss:/, "");
    const sourceId = sourceByItemId.get(itemId);
    if (!sourceId) continue;

    const existing =
      statsMap.get(sourceId) ??
      ({
        sourceId,
        totalOpened: 0,
        completed: 0,
        inProgress: 0,
        avgCompletionPct: 0,
      } satisfies UserSourceStats);

    existing.totalOpened += 1;
    if (row.completedAt || row.completionPct >= 99) existing.completed += 1;
    else existing.inProgress += 1;
    existing.avgCompletionPct += row.completionPct;
    if (!existing.lastOpenedAt && row.lastOpenedAt) {
      existing.lastOpenedAt = row.lastOpenedAt.toISOString();
    }

    statsMap.set(sourceId, existing);
  }

  return [...statsMap.values()].map((stat) => ({
    ...stat,
    avgCompletionPct: stat.totalOpened > 0 ? Math.round(stat.avgCompletionPct / stat.totalOpened) : 0,
  }));
}

async function getLlmRanking(
  stats: UserSourceStats[],
  candidates: FeedItem[]
): Promise<Map<string, { include: boolean; score: number }>> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || stats.length === 0 || candidates.length === 0) return new Map();

  const body = {
    model: PERSONALIZATION_MODEL,
    input: [
      {
        role: "system",
        content:
          "You rank RSS articles for one user from their engagement history. Return compact JSON only: {\"ranking\":[{\"id\":string,\"score\":0-100,\"include\":boolean}]}. Keep only high-value items include=true; leave borderline include=false.",
      },
      {
        role: "user",
        content: JSON.stringify({
          userSourceStats: stats,
          candidates: candidates.map((item) => ({
            id: item.id,
            sourceId: item.sourceId,
            publicationName: item.publicationName,
            subject: item.subject,
            snippet: item.snippet?.slice(0, 220),
            date: item.date,
          })),
        }),
      },
    ],
    max_output_tokens: 500,
  };

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) return new Map();
  const data = (await response.json()) as {
    output_text?: string;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };

  const outputText =
    data.output_text ??
    data.output
      ?.flatMap((block) => block.content ?? [])
      .find((part) => part.type === "output_text" && typeof part.text === "string")
      ?.text ??
    "";

  const parsed = parseJsonObject(outputText);
  const ranking = parsed?.ranking;
  if (!Array.isArray(ranking)) return new Map();

  const result = new Map<string, { include: boolean; score: number }>();
  for (const row of ranking) {
    if (!row || typeof row.id !== "string") continue;
    result.set(row.id, {
      include: row.include !== false,
      score: typeof row.score === "number" ? row.score : 50,
    });
  }
  return result;
}

export async function personalizeRssItems(userId: string, rssItems: FeedItem[]): Promise<FeedItem[]> {
  if (rssItems.length <= 1) return rssItems;

  const sourceIds = [...new Set(rssItems.map((item) => item.sourceId).filter((id): id is string => !!id))];
  const stats = await getUserRssStats(userId, sourceIds);
  if (stats.length === 0) return rssItems;

  const ranked = await getLlmRanking(stats, rssItems.slice(0, 120));
  if (ranked.size === 0) {
    return [...rssItems].sort((a, b) => {
      const ta = new Date(a.date).getTime();
      const tb = new Date(b.date).getTime();
      return tb - ta;
    });
  }

  const filtered = rssItems.filter((item) => ranked.get(item.id)?.include !== false);
  return filtered.sort((a, b) => {
    const scoreA = ranked.get(a.id)?.score ?? 50;
    const scoreB = ranked.get(b.id)?.score ?? 50;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });
}
