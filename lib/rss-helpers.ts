import { prisma } from "@/lib/prisma";

export type RssReadProfile = {
  topPublications: Array<{ name: string; score: number }>;
  avgCompletionPct: number;
  recentReadCount7d: number;
  preferenceSummary: string[];
  customPrompt?: string | null;
};

type RssPriority = "HIGH" | "NORMAL" | "LOW";

type ReadProfileSnapshotRow = {
  topPublications: unknown;
  avgCompletionPct: number;
  recentReadCount7d: number;
  preferenceSummary: unknown;
  weekKey: string;
};

type OpenRouterProfileResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

export function dayKeyUtc(value: Date | null): string {
  if (!value) return "unknown";
  const y = value.getUTCFullYear();
  const m = `${value.getUTCMonth() + 1}`.padStart(2, "0");
  const d = `${value.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function weekKeyUtc(value: Date | null): string {
  if (!value) return "unknown";
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function rssPriorityScore(priority: RssPriority): number {
  if (priority === "HIGH") return 3;
  if (priority === "NORMAL") return 2;
  return 1;
}

export function sortByPriorityAndRecency<T>(
  items: T[],
  getPriority: (item: T) => RssPriority,
  getSortTimeMs: (item: T) => number
): T[] {
  return [...items].sort((a, b) => {
    const pa = rssPriorityScore(getPriority(a));
    const pb = rssPriorityScore(getPriority(b));
    if (pa !== pb) return pb - pa;
    return getSortTimeMs(b) - getSortTimeMs(a);
  });
}

export function getRssLookbackDays(): number {
  const raw = Number(process.env.RSS_LOOKBACK_DAYS ?? 5);
  if (!Number.isFinite(raw)) return 5;
  return Math.min(30, Math.max(1, Math.floor(raw)));
}

export function getRssLookbackCutoff(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export function getRssDailyTargetCap(totalCandidates: number, preferredCap?: number | null): number {
  const minRaw = Number(process.env.RSS_DAILY_TARGET_MIN ?? 30);
  const maxRaw = Number(process.env.RSS_DAILY_TARGET_MAX ?? 40);
  const defaultRaw = Number(process.env.RSS_DAILY_TARGET_DEFAULT ?? 35);

  const minCap = Number.isFinite(minRaw) ? Math.max(1, Math.floor(minRaw)) : 10;
  const maxCap = Number.isFinite(maxRaw) ? Math.max(minCap, Math.floor(maxRaw)) : 15;
  const envDefaultCap = Number.isFinite(defaultRaw)
    ? Math.min(maxCap, Math.max(minCap, Math.floor(defaultRaw)))
    : 35;
  const preferred = Number.isFinite(preferredCap as number)
    ? Math.floor(preferredCap as number)
    : envDefaultCap;
  const defaultCap = Math.min(maxCap, Math.max(minCap, preferred));

  if (!Number.isFinite(totalCandidates) || totalCandidates <= 0) return 0;
  return Math.min(Math.floor(totalCandidates), defaultCap);
}

export function extractImageUrlFromHtml(html?: string | null): string | undefined {
  if (!html) return undefined;
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) return og[1];
  const img = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (img?.[1]) return img[1];
  return undefined;
}

function normalizeUrlForDedup(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    const dropParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "utm_id",
      "gclid",
      "fbclid",
      "mc_cid",
      "mc_eid",
    ];
    for (const key of dropParams) parsed.searchParams.delete(key);
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const query = parsed.searchParams.toString();
    return `${parsed.hostname.toLowerCase()}${path}${query ? `?${query}` : ""}`;
  } catch {
    return null;
  }
}

function normalizeTextForDedup(input?: string | null): string {
  return (input ?? "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildRssArticleDedupKey(args: {
  externalUrl?: string | null;
  title?: string | null;
  snippet?: string | null;
}): string {
  const canonicalUrl = normalizeUrlForDedup(args.externalUrl);
  if (canonicalUrl) return `url:${canonicalUrl}`;
  const title = normalizeTextForDedup(args.title);
  const snippet = normalizeTextForDedup(args.snippet).slice(0, 140);
  return `text:${title}|${snippet}`;
}

export function dedupeByArticleKey<T extends { dedupKey: string }>(
  items: T[],
  scoreItem: (item: T) => number,
  sortTimeMs: (item: T) => number
): T[] {
  const dedupedByKey = new Map<string, T>();
  for (const item of items) {
    const prev = dedupedByKey.get(item.dedupKey);
    if (!prev) {
      dedupedByKey.set(item.dedupKey, item);
      continue;
    }
    const prevScore = scoreItem(prev);
    const nextScore = scoreItem(item);
    if (nextScore > prevScore || (nextScore === prevScore && sortTimeMs(item) > sortTimeMs(prev))) {
      dedupedByKey.set(item.dedupKey, item);
    }
  }
  return [...dedupedByKey.values()];
}

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

function contentToString(
  content: string | Array<{ type?: string; text?: string }> | undefined
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
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

  const model = process.env.OPENROUTER_PROFILE_MODEL ?? process.env.OPENROUTER_MODEL ?? "openrouter/free";
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(process.env.OPENROUTER_SITE_URL ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL } : {}),
        ...(process.env.OPENROUTER_APP_NAME ? { "X-Title": process.env.OPENROUTER_APP_NAME } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 450,
        messages: [
          {
            role: "system",
            content: "You are a profiling engine. Output strict JSON only with no extra text.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as OpenRouterProfileResponse;
    const content = contentToString(data.choices?.[0]?.message?.content);
    if (!content) return null;
    return parseSummaryFromLlm(content);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
