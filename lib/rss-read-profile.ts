import { prisma } from "@/lib/prisma";
import { RANKING_MODEL, openRouterChat } from "@/lib/openrouter";
import { weekKeyUtc } from "@/lib/rss-helpers";

/**
 * Weekly reading profile fed to the AI ranker: top publications scored from
 * read stats, plus an LLM-written preference summary. Computed from
 * MessageReadStat history and cached per-week in UserRssReadProfileSnapshot
 * so the summary LLM call runs at most once a week per user.
 */

export type RssReadProfile = {
  topPublications: Array<{ name: string; score: number }>;
  avgCompletionPct: number;
  recentReadCount7d: number;
  preferenceSummary: string[];
  customPrompt?: string | null;
};

type ReadProfileSnapshotRow = {
  topPublications: unknown;
  avgCompletionPct: number;
  recentReadCount7d: number;
  preferenceSummary: unknown;
  weekKey: string;
};

function normalizeTopPublications(value: unknown): Array<{ name: string; score: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      const parsed = row as { name?: unknown; score?: unknown };
      if (typeof parsed?.name !== "string" || typeof parsed?.score !== "number") return null;
      return { name: parsed.name, score: parsed.score };
    })
    .filter((row): row is { name: string; score: number } => Boolean(row));
}

function normalizePreferenceSummary(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is string => typeof row === "string");
}

function parseSnapshotToProfile(snapshot: ReadProfileSnapshotRow): RssReadProfile {
  return {
    topPublications: normalizeTopPublications(snapshot.topPublications),
    avgCompletionPct: snapshot.avgCompletionPct,
    recentReadCount7d: snapshot.recentReadCount7d,
    preferenceSummary: normalizePreferenceSummary(snapshot.preferenceSummary),
  };
}

function parseSummaryFromLlm(raw: string): string[] | null {
  const firstJson = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
  try {
    const parsed = JSON.parse(firstJson) as { summary?: unknown };
    if (!Array.isArray(parsed.summary)) return null;
    const summary = parsed.summary
      .filter((line): line is string => typeof line === "string")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8);
    return summary.length > 0 ? summary : null;
  } catch {
    return null;
  }
}

async function generatePreferenceSummaryWithLlm(args: {
  topPublications: Array<{ name: string; score: number }>;
  avgCompletionPct: number;
  recentReadCount7d: number;
  reads: Array<{ source: string; title: string }>;
}): Promise<string[] | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  if (args.reads.length === 0) return null;

  const readLines = args.reads.map((item, i) => `${i + 1}. source=${item.source} | title=${item.title}`).join("\n");
  const topPubs = args.topPublications
    .slice(0, 10)
    .map((p) => `${p.name}(${p.score.toFixed(1)})`)
    .join(", ");

  const prompt =
    `Create a concise weekly reading-profile summary for RSS recommendations.

Stats:
top_publications=${topPubs || "none"}
avg_completion_pct=${args.avgCompletionPct.toFixed(1)}
recent_reads_7d=${args.recentReadCount7d}

Read history (source + title):
${readLines}

Return exactly one line JSON only:
{"summary":["...", "..."]}
Rules:
- 4 to 8 bullet-like lines.
- Mention themes, favored sources, depth/format preference, and recency tendency.
- No markdown, no prose outside JSON.`;

  const result = await openRouterChat({
    apiKey,
    model: RANKING_MODEL,
    maxTokens: 450,
    timeoutMs: 20000,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: "You are a profiling engine. Output strict JSON only with no extra text.",
      },
      { role: "user", content: prompt },
    ],
  });
  if (!result.ok || !result.content) return null;
  return parseSummaryFromLlm(result.content);
}

async function computeUserRssReadProfile(userId: string): Promise<RssReadProfile> {
  const rows = await prisma.messageReadStat.findMany({
    where: {
      userId,
      OR: [{ sourceKind: "rss" }, { messageExternalId: { startsWith: "rss:" } }],
    },
    select: {
      publicationName: true,
      messageTitle: true,
      completionPct: true,
      openCount: true,
      lastOpenedAt: true,
    },
    orderBy: { lastOpenedAt: "desc" },
    take: 600,
  });

  if (rows.length === 0) {
    return {
      topPublications: [],
      avgCompletionPct: 0,
      recentReadCount7d: 0,
      preferenceSummary: [],
    };
  }

  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  let completionTotal = 0;
  let recentReadCount7d = 0;
  const publicationScores = new Map<string, number>();

  for (const row of rows) {
    const completion = Number.isFinite(row.completionPct) ? row.completionPct : 0;
    completionTotal += completion;
    if (row.lastOpenedAt && now - row.lastOpenedAt.getTime() <= sevenDaysMs) {
      recentReadCount7d += 1;
    }
    const publication = row.publicationName?.trim();
    if (!publication) continue;
    const openCount = Math.max(1, row.openCount || 1);
    const score = completion / 100 + Math.min(3, openCount * 0.35);
    publicationScores.set(publication, (publicationScores.get(publication) ?? 0) + score);
  }

  const topPublications = [...publicationScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, score]) => ({ name, score }));

  const avgCompletionPct = completionTotal / rows.length;
  const defaultPreferenceSummary: string[] = [];
  if (topPublications.length > 0) {
    defaultPreferenceSummary.push(
      `Frequently read publications: ${topPublications
        .slice(0, 5)
        .map((p) => p.name)
        .join(", ")}`
    );
  }
  defaultPreferenceSummary.push(`Average completion is ${avgCompletionPct.toFixed(0)}%`);
  defaultPreferenceSummary.push(`Read activity in last 7 days: ${recentReadCount7d} opened items`);
  const llmSummary = await generatePreferenceSummaryWithLlm({
    topPublications,
    avgCompletionPct,
    recentReadCount7d,
    reads: rows
      .map((row) => ({
        source: row.publicationName?.trim() || "Unknown source",
        title: row.messageTitle?.trim() || "",
      }))
      .filter((row) => row.title.length > 0)
      .slice(0, 220),
  });
  const preferenceSummary = llmSummary ?? defaultPreferenceSummary;

  return {
    topPublications,
    avgCompletionPct,
    recentReadCount7d,
    preferenceSummary,
  };
}

export async function getUserRssReadProfile(userId: string): Promise<RssReadProfile> {
  const now = new Date();
  const currentWeekKey = weekKeyUtc(now);
  const snapshot = await prisma.userRssReadProfileSnapshot.findUnique({
    where: { userId },
    select: {
      topPublications: true,
      avgCompletionPct: true,
      recentReadCount7d: true,
      preferenceSummary: true,
      weekKey: true,
      updatedAt: true,
    },
  });
  if (snapshot && snapshot.weekKey === currentWeekKey && now.getTime() - snapshot.updatedAt.getTime() < 7 * 86400000) {
    return parseSnapshotToProfile(snapshot);
  }

  const computed = await computeUserRssReadProfile(userId);
  await prisma.userRssReadProfileSnapshot.upsert({
    where: { userId },
    update: {
      weekKey: currentWeekKey,
      topPublications: computed.topPublications,
      avgCompletionPct: computed.avgCompletionPct,
      recentReadCount7d: computed.recentReadCount7d,
      preferenceSummary: computed.preferenceSummary,
    },
    create: {
      userId,
      weekKey: currentWeekKey,
      topPublications: computed.topPublications,
      avgCompletionPct: computed.avgCompletionPct,
      recentReadCount7d: computed.recentReadCount7d,
      preferenceSummary: computed.preferenceSummary,
    },
  });
  return computed;
}
