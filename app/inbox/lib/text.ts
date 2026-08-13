/**
 * Trim a snippet down to its first sentence, capped at `maxChars`.
 * Shared by the list row (tight) and the swipe card (roomier).
 */
export function summarizeSnippet(snippet: string, maxChars = 170): string {
  const normalized = snippet.replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const firstSentence = normalized.split(/(?<=[.!?])\s+/)[0] ?? normalized;
  if (firstSentence.length <= maxChars) return firstSentence;
  return `${firstSentence.slice(0, maxChars).trimEnd()}...`;
}
