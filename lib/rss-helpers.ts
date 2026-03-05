import { prisma } from "@/lib/prisma";

export type RssReadProfile = {
  topPublications: Array<{ name: string; score: number }>;
  avgCompletionPct: number;
  recentReadCount7d: number;
  preferenceSummary: string[];
};

export function dayKeyUtc(value: Date | null): string {
  if (!value) return "unknown";
  const y = value.getUTCFullYear();
  const m = `${value.getUTCMonth() + 1}`.padStart(2, "0");
  const d = `${value.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getRssLookbackDays(): number {
  const raw = Number(process.env.RSS_LOOKBACK_DAYS ?? 5);
  if (!Number.isFinite(raw)) return 5;
  return Math.min(30, Math.max(1, Math.floor(raw)));
}

export function getRssLookbackCutoff(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export function getRssDailyTargetCap(totalCandidates: number): number {
  const minRaw = Number(process.env.RSS_DAILY_TARGET_MIN ?? 10);
  const maxRaw = Number(process.env.RSS_DAILY_TARGET_MAX ?? 15);
  const defaultRaw = Number(process.env.RSS_DAILY_TARGET_DEFAULT ?? 12);

  const minCap = Number.isFinite(minRaw) ? Math.max(1, Math.floor(minRaw)) : 10;
  const maxCap = Number.isFinite(maxRaw) ? Math.max(minCap, Math.floor(maxRaw)) : 15;
  const defaultCap = Number.isFinite(defaultRaw)
    ? Math.min(maxCap, Math.max(minCap, Math.floor(defaultRaw)))
    : 12;

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

export async function getUserRssReadProfile(userId: string): Promise<RssReadProfile> {
  const rows = await prisma.messageReadStat.findMany({
    where: {
      userId,
      OR: [{ sourceKind: "rss" }, { messageExternalId: { startsWith: "rss:" } }],
    },
    select: {
      publicationName: true,
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
  const preferenceSummary: string[] = [];
  if (topPublications.length > 0) {
    preferenceSummary.push(
      `Frequently read publications: ${topPublications
        .slice(0, 5)
        .map((p) => p.name)
        .join(", ")}`
    );
  }
  preferenceSummary.push(`Average completion is ${avgCompletionPct.toFixed(0)}%`);
  preferenceSummary.push(`Read activity in last 7 days: ${recentReadCount7d} opened items`);

  return {
    topPublications,
    avgCompletionPct,
    recentReadCount7d,
    preferenceSummary,
  };
}
