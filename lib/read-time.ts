import { prisma } from "@/lib/prisma";

/** A common adult silent-reading speed for non-fiction. */
export const WORDS_PER_MINUTE = 230;
/** Below this it's a link roundup or a teaser, and "1 min" would be noise. */
const MIN_WORDS = 120;

/** Whole minutes to read `words`, or undefined when it's too short to be worth a badge. */
export function readMinutes(words: number): number | undefined {
  if (!Number.isFinite(words) || words < MIN_WORDS) return undefined;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/**
 * Word counts for stored newsletter issues, computed in Postgres.
 *
 * Why in SQL: Today lists up to 200 issues and each body can be 50-100 KB.
 * Counting in the database sends back one number per issue instead of
 * megabytes of HTML on every page load, and needs no new column (so no
 * migration on her real data). The plain-text part is used when the email
 * has one; otherwise the HTML with <style>/<script> blocks and tags removed.
 *
 * Postgres regex note: a pattern's overall greediness follows its *first*
 * quantifier, so `[^>]*?` (lazy) is what makes `.*?` stop at the first
 * closing tag instead of the last one.
 */
export async function newsletterWordCounts(userId: string, gmailMessageIds: string[]): Promise<Map<string, number>> {
  // An issue's body never changes after it's stored, so a count is good
  // forever. Stripping tags from HTML-only issues costs ~5 ms each in
  // Postgres, so a warm server only ever counts the new ones.
  const missing = gmailMessageIds.filter((id) => !wordCountCache.has(cacheKey(userId, id)));
  if (missing.length > 0) {
    for (const [id, words] of await countWords(userId, missing)) remember(cacheKey(userId, id), words);
  }
  const result = new Map<string, number>();
  for (const id of gmailMessageIds) {
    const words = wordCountCache.get(cacheKey(userId, id));
    if (words !== undefined) result.set(id, words);
  }
  return result;
}

const MAX_CACHED = 5000;
const wordCountCache = new Map<string, number>();
const cacheKey = (userId: string, id: string) => `${userId}:${id}`;

function remember(key: string, words: number) {
  // Map keeps insertion order, so the first key is the oldest: a cheap FIFO cap.
  if (wordCountCache.size >= MAX_CACHED) {
    const oldest = wordCountCache.keys().next().value;
    if (oldest !== undefined) wordCountCache.delete(oldest);
  }
  wordCountCache.set(key, words);
}

async function countWords(userId: string, gmailMessageIds: string[]): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ id: string; words: number | bigint | null }>>`
    SELECT "gmailMessageId" AS id,
      array_length(
        regexp_split_to_array(
          btrim(regexp_replace(
            coalesce(
              nullif(btrim("text"), ''),
              regexp_replace(
                regexp_replace(
                  regexp_replace(coalesce("html", ''), '<style[^>]*?>.*?</style>', ' ', 'gi'),
                  '<script[^>]*?>.*?</script>', ' ', 'gi'),
                '<[^>]+>', ' ', 'g')
            ),
            '\\s+', ' ', 'g')),
          ' '),
        1) AS words
    FROM "NewsletterIssue"
    WHERE "userId" = ${userId} AND "gmailMessageId" = ANY(${gmailMessageIds})
  `;
  return new Map(rows.map((row) => [row.id, Number(row.words ?? 0)]));
}
