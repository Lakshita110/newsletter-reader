export const RSS_CATEGORY_OPTIONS = [
  "politics",
  "news",
  "business",
  "tech",
  "finance",
  "science",
  "world",
  "culture",
  "other",
] as const;

export type RssCategory = (typeof RSS_CATEGORY_OPTIONS)[number];

const CATEGORY_SET = new Set<string>(RSS_CATEGORY_OPTIONS);

export function normalizeRssCategory(value: string): RssCategory | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (!CATEGORY_SET.has(normalized)) return null;
  return normalized as RssCategory;
}

export function parseRssCategoryInput(input: unknown): {
  isProvided: boolean;
  isInvalid: boolean;
  value: RssCategory | null;
} {
  if (typeof input !== "string") {
    return { isProvided: false, isInvalid: false, value: null };
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return { isProvided: true, isInvalid: false, value: null };
  }
  const normalized = normalizeRssCategory(trimmed);
  if (!normalized) {
    return { isProvided: true, isInvalid: true, value: null };
  }
  return { isProvided: true, isInvalid: false, value: normalized };
}

export function getRssCategoryLabel(value: string): string {
  const normalized = normalizeRssCategory(value);
  if (!normalized) return value;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
