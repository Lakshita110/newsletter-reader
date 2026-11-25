import { normalizeRssCategory, type RssCategory } from "@/lib/rss-categories";

/**
 * Feeds listed in an OPML export (what every feed reader exports). A
 * `category` attribute (OPML 2.0, comma-separated) is kept when one of its
 * values is a category the app knows, e.g. category="newsletter".
 */
export function parseOpml(opml: string): Array<{ title: string; xmlUrl: string; category?: RssCategory }> {
  const decode = (v: string) =>
    v
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  const out = new Map<string, { title: string; xmlUrl: string; category?: RssCategory }>();
  for (const tag of opml.match(/<outline\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1];
    const xmlUrl = attr("xmlUrl");
    if (!xmlUrl || !/^https?:\/\//i.test(xmlUrl)) continue;
    const url = decode(xmlUrl);
    const category = (attr("category") ?? "")
      .split(",")
      .map((value) => normalizeRssCategory(decode(value).replace(/^\//, "")))
      .find((value) => value !== null);
    out.set(url, {
      xmlUrl: url,
      title: decode(attr("title") ?? attr("text") ?? new URL(url).hostname),
      ...(category ? { category } : {}),
    });
  }
  return [...out.values()];
}
