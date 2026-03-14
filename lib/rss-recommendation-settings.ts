export const RSS_RECOMMENDATION_CAP_MIN = 10;
export const RSS_RECOMMENDATION_CAP_MAX = 60;
export const RSS_RECOMMENDATION_CAP_DEFAULT = 35;
export const RSS_RECOMMENDATION_PROMPT_MAX_CHARS = 500;

export function normalizeRecommendationCap(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return RSS_RECOMMENDATION_CAP_DEFAULT;
  return Math.min(RSS_RECOMMENDATION_CAP_MAX, Math.max(RSS_RECOMMENDATION_CAP_MIN, Math.floor(parsed)));
}

export function normalizeRecommendationPrompt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, RSS_RECOMMENDATION_PROMPT_MAX_CHARS);
}
