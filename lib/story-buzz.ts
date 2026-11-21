import { extractEntities } from "@/lib/coverage";

/**
 * "How big is this story today?" = how many of her other sources are running
 * the same story. Wire-level news (a market sell-off, NATO membership talks)
 * shows up across FT, WSJ, NYT and the Economist at once; a quirky feature
 * shows up in one place. The ranker gets this count as `coverage=N` and is
 * told to put the most widely covered stories near the top, which is what a
 * front page editor does.
 *
 * Deterministic and cheap on purpose: it runs on every ranking, needs no
 * model call, and its matches can be explained.
 *
 * Two stories match when they share at least two names (people, companies,
 * countries) in their headlines, or at least three distinctive content
 * words across headline and teaser. The content-word path catches
 * name-less headlines like "Stocks tumble as bond yields jump".
 */

const STOP = new Set(
  (
    "about after again against amid also because been before being between both could does doing during each from " +
    "further have having here into just more most other over same should some such than that their them then there " +
    "these they this those through under until very were what when where which while will with would year years week " +
    "says said told according report reports today first last make made many much news latest update live analysis " +
    "opinion inside could your what's it's new"
  ).split(" ")
);

function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || STOP.has(raw) || /^\d+$/.test(raw)) continue;
    // Light stemming so "stocks"/"stock" and "tumbled"/"tumble" meet.
    out.add(raw.replace(/(ing|ed|es|s)$/, ""));
  }
  return out;
}

type StoryInput = { id: string; sourceName: string; title: string; snippet?: string | null };

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

/** For each story id, the number of *other* sources carrying a matching story. */
export function countSourceCoverage(stories: StoryInput[]): Map<string, number> {
  const prepared = stories.map((s) => ({
    ...s,
    source: s.sourceName.trim().toLowerCase(),
    names: new Set(extractEntities(s.title).map((e) => e.toLowerCase())),
    words: contentWords(`${s.title} ${(s.snippet ?? "").slice(0, 200)}`),
  }));
  const coverage = new Map<string, number>();
  for (const story of prepared) {
    const sources = new Set<string>();
    for (const other of prepared) {
      if (other.source === story.source || sources.has(other.source)) continue;
      if (overlap(story.names, other.names) >= 2 || overlap(story.words, other.words) >= 3) {
        sources.add(other.source);
      }
    }
    coverage.set(story.id, sources.size);
  }
  return coverage;
}
