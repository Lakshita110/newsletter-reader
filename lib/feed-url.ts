/**
 * Turn whatever she pastes into an RSS URL. Mostly this is about Substack:
 * every publication serves its full feed at `/feed`, but nobody copies that,
 * they copy a post link, the publication homepage, or just the handle.
 *
 * - "lenny"                                    -> https://lenny.substack.com/feed
 * - "lenny.substack.com" / any *.substack.com  -> https://<host>/feed
 * - open.substack.com/pub/<name>/p/...         -> https://<name>.substack.com/feed
 * - custom domain post link (/p/<slug>)        -> https://<host>/feed
 *   (the /p/ path is Substack's post URL shape, e.g. lennysnewsletter.com/p/...)
 * Anything else is returned unchanged, so a normal feed URL still works.
 */
export function resolveFeedUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return raw;

  // A bare handle: letters, digits and dashes only.
  if (/^[a-z0-9-]+$/i.test(raw)) return `https://${raw.toLowerCase()}.substack.com/feed`;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return raw;
  }
  const host = url.hostname.toLowerCase();

  if (host === "open.substack.com") {
    const pub = url.pathname.match(/^\/pub\/([a-z0-9-]+)/i)?.[1];
    return pub ? `https://${pub.toLowerCase()}.substack.com/feed` : raw;
  }
  if (host.endsWith(".substack.com") && host !== "www.substack.com") {
    return `https://${host}/feed`;
  }
  if (url.pathname.startsWith("/p/")) {
    return `https://${host}/feed`;
  }
  return url.toString();
}
