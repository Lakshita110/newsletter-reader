/**
 * Pick the lead photo of a newsletter email for the Today list.
 *
 * Email HTML is full of images that aren't the story: 1x1 tracking pixels,
 * the publication's logo, author avatars, social icons, "listen in app"
 * badges. Taking the first <img> (what RSS uses) would usually give a logo
 * or a pixel, so this skips anything that looks like chrome and anything
 * declared small, and returns the first remaining https image.
 */
const CHROME_HINTS =
  /(pixel|track|open\.|\/o\/|beacon|spacer|logo|avatar|icon|badge|emoji|button|social|facebook|twitter|linkedin|instagram|youtube|app-?store|google-?play|signature|header-?image|\.gif(\?|$))/i;
const CHROME_ALT =
  /\b(logo|avatar|icon|profile|facebook|twitter|linkedin|instagram|share|subscribe|app store|google play)\b/i;

/** Smallest declared width or height for a real photo; logos and icons are below this. */
const MIN_DIMENSION = 120;

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

/** Declared size from width/height attributes or an inline style; null when not declared. */
function declaredSize(tag: string, name: "width" | "height"): number | null {
  const fromAttr = attr(tag, name);
  const fromStyle = attr(tag, "style")?.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*(\\d+)px`, "i"))?.[1];
  const raw = fromAttr ?? fromStyle;
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function pickLeadImage(html: string | null | undefined): string | null {
  if (!html) return null;
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = attr(tag, "src")?.replace(/&amp;/g, "&");
    if (!src || !src.startsWith("https://")) continue;
    if (CHROME_HINTS.test(src) || CHROME_ALT.test(attr(tag, "alt") ?? "")) continue;
    const width = declaredSize(tag, "width");
    const height = declaredSize(tag, "height");
    if ((width !== null && width < MIN_DIMENSION) || (height !== null && height < MIN_DIMENSION)) continue;
    return src;
  }
  return null;
}

/**
 * Hostname whose favicon represents an item: the article/post URL when there
 * is one (pub.substack.com gives that publication's logo, not Substack's),
 * otherwise the sender's mail domain.
 */
export function faviconDomain(externalUrl?: string | null, from?: string | null): string | null {
  if (externalUrl) {
    try {
      return new URL(externalUrl).hostname.replace(/^www\./, "");
    } catch {
      // fall through to the sender
    }
  }
  const domain = from?.match(/@([a-z0-9.-]+\.[a-z]{2,})/i)?.[1]?.toLowerCase();
  if (!domain) return null;
  // Bulk-mail subdomains (mail.beehiiv.com, email.example.com) have no icon of their own.
  return domain.replace(/^(e?mail|news|newsletter|info|send|mg|em\d*)\./, "");
}
