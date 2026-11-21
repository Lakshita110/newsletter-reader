/** Feeds listed in an OPML export (what every feed reader exports). */
export function parseOpml(opml: string): Array<{ title: string; xmlUrl: string }> {
  const decode = (v: string) =>
    v
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  const out = new Map<string, { title: string; xmlUrl: string }>();
  for (const tag of opml.match(/<outline\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1];
    const xmlUrl = attr("xmlUrl");
    if (!xmlUrl || !/^https?:\/\//i.test(xmlUrl)) continue;
    const url = decode(xmlUrl);
    out.set(url, { xmlUrl: url, title: decode(attr("title") ?? attr("text") ?? new URL(url).hostname) });
  }
  return [...out.values()];
}
