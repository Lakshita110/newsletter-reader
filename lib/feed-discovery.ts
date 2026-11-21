/**
 * Find the RSS/Atom feed for a website, so adding a source can take whatever
 * she pastes (a homepage, an article link) instead of needing the feed URL.
 *
 * Order: the page's own <link rel="alternate"> tags (what browsers and feed
 * readers use), then the paths most sites put feeds at.
 */

const COMMON_FEED_PATHS = ["/feed", "/rss", "/feed.xml", "/rss.xml", "/atom.xml", "/index.xml", "/feeds/posts/default"];

/** Feed URLs advertised in a page's <head>, resolved against the page URL. */
export function feedLinksFromHtml(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
    const rel = attr("rel")?.toLowerCase() ?? "";
    const type = attr("type")?.toLowerCase() ?? "";
    const href = attr("href");
    if (!href || !rel.split(/\s+/).includes("alternate")) continue;
    if (!/(rss|atom)\+xml|application\/feed\+json/.test(type)) continue;
    try {
      out.push(new URL(href.replace(/&amp;/g, "&"), pageUrl).toString());
    } catch {
      // A malformed href on someone else's site; skip it.
    }
  }
  return [...new Set(out)];
}

/** Candidate feed URLs for a site, best first. The caller checks which one parses. */
export async function discoverFeedCandidates(
  pageUrl: string,
  fetchPage: (url: string) => Promise<string | null>
): Promise<string[]> {
  const html = await fetchPage(pageUrl);
  const advertised = html ? feedLinksFromHtml(html, pageUrl) : [];
  const origin = new URL(pageUrl).origin;
  const guesses = COMMON_FEED_PATHS.map((path) => `${origin}${path}`);
  return [...new Set([...advertised, ...guesses])];
}
