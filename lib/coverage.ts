/**
 * "Already covered in your newsletters": flag news stories whose subject a
 * newsletter you get has already written about, so Today can fold them away.
 *
 * Deliberately deterministic (no LLM): it runs on every inbox load, costs
 * nothing, and its decisions are explainable ("matched Nvidia, China").
 *
 * Signal: the distinctive names in a headline (proper nouns, acronyms,
 * tickers). A story counts as covered when at least two of them, and most of
 * them, appear in a recent newsletter issue. Generic headlines with fewer
 * than two names ("Markets rally as rates ease") are never folded; there's
 * not enough evidence either way.
 */

const STOP = new Set(
  "A An The And Or But If In On At To For Of By With From As Is Are Was Were Be Been Its It This That These Those How Why What When Where Who Will Can Could Should Would May Might Must After Before Over Under Into About Amid Against Than Then New Says Said Report Reports Exclusive Analysis Opinion Live Update Updates Week Today Year Inside Here".split(
    " "
  )
);

/** Distinctive names in a headline, e.g. "Nvidia's China sales slump" → [Nvidia, China]. */
export function extractEntities(title: string): string[] {
  const words = title
    .replace(/[‘’]/g, "'")
    .split(/[^A-Za-z0-9'&.-]+/)
    .map((w) => w.replace(/'s$/i, "").replace(/^[.'-]+|[.'-]+$/g, ""))
    .filter(Boolean);
  const out: string[] = [];
  words.forEach((w, i) => {
    const isAcronym = /^[A-Z][A-Z0-9&]{1,6}$/.test(w);
    const isProper = /^[A-Z][A-Za-z0-9&]*[a-z][A-Za-z0-9&]*$/.test(w) && (i > 0 || !STOP.has(w));
    if ((isAcronym || isProper) && !STOP.has(w) && w.length > 1) out.push(w);
  });
  return [...new Set(out)];
}

export type CoverageSource = { id: string; publicationName: string; subject: string; text: string };

export type Coverage = { byId: string; publicationName: string; subject: string; matched: string[] };

function containsWord(haystack: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}('s)?([^A-Za-z0-9]|$)`).test(haystack);
}

/**
 * How much of a newsletter counts as "what it's about". Matching names
 * anywhere in a long issue folded nearly every news story: a daily digest
 * mentions Trump, China and Nvidia somewhere every day. The subject and
 * opening are where a newsletter's actual topic is.
 */
export const COVERAGE_LEDE_CHARS = 1500;

export function findCoverage(storyTitle: string, sources: CoverageSource[]): Coverage | null {
  const entities = extractEntities(storyTitle);
  if (entities.length < 2) return null;
  let best: Coverage | null = null;
  for (const source of sources) {
    const hay = `${source.subject}\n${source.text.slice(0, COVERAGE_LEDE_CHARS)}`;
    const matched = entities.filter((e) => containsWord(hay, e));
    if (matched.length >= 2 && matched.length / entities.length >= 0.6) {
      if (!best || matched.length > best.matched.length) {
        best = { byId: source.id, publicationName: source.publicationName, subject: source.subject, matched };
      }
    }
  }
  return best;
}

/** Cheap HTML → text good enough for name matching (no DOM needed). */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, " ");
}
