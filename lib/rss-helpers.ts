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

export function getRssLookbackDays(): number {
  const raw = Number(process.env.RSS_LOOKBACK_DAYS ?? 5);
  if (!Number.isFinite(raw)) return 5;
  return Math.min(30, Math.max(1, Math.floor(raw)));
}

export function getRssLookbackCutoff(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

const DAILY_TARGET_MIN_DEFAULT = 30;
const DAILY_TARGET_MAX_DEFAULT = 40;
const DAILY_TARGET_DEFAULT = 35;

export function getRssDailyTargetCap(totalCandidates: number, preferredCap?: number | null): number {
  const minRaw = Number(process.env.RSS_DAILY_TARGET_MIN ?? DAILY_TARGET_MIN_DEFAULT);
  const maxRaw = Number(process.env.RSS_DAILY_TARGET_MAX ?? DAILY_TARGET_MAX_DEFAULT);
  const defaultRaw = Number(process.env.RSS_DAILY_TARGET_DEFAULT ?? DAILY_TARGET_DEFAULT);

  const minCap = Number.isFinite(minRaw) ? Math.max(1, Math.floor(minRaw)) : DAILY_TARGET_MIN_DEFAULT;
  const maxCap = Number.isFinite(maxRaw) ? Math.max(minCap, Math.floor(maxRaw)) : Math.max(minCap, DAILY_TARGET_MAX_DEFAULT);
  const envDefaultCap = Number.isFinite(defaultRaw)
    ? Math.min(maxCap, Math.max(minCap, Math.floor(defaultRaw)))
    : Math.min(maxCap, Math.max(minCap, DAILY_TARGET_DEFAULT));
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
  sortTimeMs: (item: T) => number
): T[] {
  const dedupedByKey = new Map<string, T>();
  for (const item of items) {
    const prev = dedupedByKey.get(item.dedupKey);
    if (!prev || sortTimeMs(item) > sortTimeMs(prev)) {
      dedupedByKey.set(item.dedupKey, item);
    }
  }
  return [...dedupedByKey.values()];
}
