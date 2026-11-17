/**
 * Pure helpers for newsletter sync, kept free of Prisma/Gmail imports so they
 * are cheap to unit test.
 */

/** How far back the very first sync reaches. Later syncs are incremental. */
export const FIRST_SYNC_LOOKBACK_DAYS = 30;
/** Overlap re-checked on each incremental sync, to catch late-delivered mail. */
export const INCREMENTAL_OVERLAP_MS = 2 * 24 * 60 * 60 * 1000;

export function normalizeSenderEmail(raw: string): string | null {
  const email = raw
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, "");
  // Deliberately loose: Gmail accepts plus-addresses and subdomains, and we
  // only need enough validation to keep junk out of the search query.
  if (!/^[^\s@()"]+@[^\s@()"]+\.[^\s@()"]+$/.test(email)) return null;
  return email;
}

/**
 * Sending domains of newsletter platforms. Mail from these is a newsletter by
 * definition, so it is always fetched, wherever it sits (archived, labeled,
 * another tab) and trusted without the heuristic classifier. This is what
 * makes Substack, Stratechery and beehiiv issues show up with zero setup:
 * before, without a sender list, only the inbox was searched, so anything a
 * Gmail filter archived or labeled never appeared.
 */
export const NEWSLETTER_PLATFORM_DOMAINS = [
  "substack.com",
  "stratechery.com",
  "beehiiv.com",
  "buttondown.email",
  "ghost.io",
  "convertkit-mail.com",
  "convertkit-mail2.com",
  "kit.com",
  "pragmaticengineer.com",
  "lennysnewsletter.com",
] as const;

/** True for a sender at a known platform domain or one of its subdomains (mail.beehiiv.com). */
export function isPlatformSender(email: string): boolean {
  const domain = email.toLowerCase().split("@")[1] ?? "";
  return NEWSLETTER_PLATFORM_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

const EXCLUDED = "-in:chats -in:spam -in:trash -in:sent";
const platformFroms = () => NEWSLETTER_PLATFORM_DOMAINS.map((d) => `from:${d}`);

/**
 * Gmail search query for an explicit sender list, plus every newsletter
 * platform. Note there is no `in:inbox` filter: newsletters she has labeled,
 * archived, or routed to another tab must still show up here.
 */
export function buildSenderQuery(senderEmails: string[], after: Date): string {
  const afterEpoch = Math.floor(after.getTime() / 1000);
  const froms = [...senderEmails.map((email) => `from:${email}`), ...platformFroms()].join(" ");
  return `{${froms}} after:${afterEpoch} ${EXCLUDED}`;
}

/**
 * Fallback for users with no sender list: newsletter platforms anywhere in
 * the mailbox, plus the inbox (where the classifier decides what counts).
 */
export function buildInboxQuery(after: Date): string {
  const afterEpoch = Math.floor(after.getTime() / 1000);
  return `{in:inbox ${platformFroms().join(" ")}} after:${afterEpoch} ${EXCLUDED}`;
}

/**
 * When the search query got wider (platform senders anywhere, 2026-11-17).
 * A mailbox last synced before this gets one full first-sync lookback, so
 * issues the old query missed in the past month are picked up too.
 */
export const QUERY_WIDENED_AT = new Date("2026-11-17T00:00:00Z");

/** Where the next sync should start reading from. */
export function syncWindowStart(lastSyncedAt: Date | null, now: Date = new Date()): Date {
  if (!lastSyncedAt || lastSyncedAt < QUERY_WIDENED_AT) {
    return new Date(now.getTime() - FIRST_SYNC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  }
  return new Date(lastSyncedAt.getTime() - INCREMENTAL_OVERLAP_MS);
}

const WEB_LINK_TEXT =
  /\b(view (this post |it |this email )?(on the web|in (your )?browser|online)|read (it )?(online|in (the )?app|on (the )?web))\b/i;
const POST_URL =
  /^https:\/\/([a-z0-9-]+\.substack\.com\/p\/|stratechery\.com\/\d{4}\/|newsletter\.pragmaticengineer\.com\/p\/|www\.lennysnewsletter\.com\/p\/|[a-z0-9.-]+\/p\/[a-z0-9-]+)/i;

/**
 * Find the canonical web URL of a newsletter issue, so the reader can offer
 * "open original" (comments, footnotes, audio). Prefers a link whose text is
 * "View in browser"-style, then the first link that looks like a post URL.
 * Tracking redirects (e.g. substack.com/redirect/...) are skipped because they
 * expire and leak opens.
 */
export function extractWebUrl(html: string | undefined | null): string | null {
  if (!html) return null;
  const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const cleaned = anchors.map(([, href, inner]) => ({
    href: href.replace(/&amp;/g, "&").trim(),
    text: inner
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  }));
  const usable = cleaned.filter(
    (a) =>
      a.href.startsWith("https://") && !/\/redirect\/|\/unsubscribe|\/action\/|list-manage|\/subscribe\b/i.test(a.href)
  );
  const labelled = usable.find((a) => WEB_LINK_TEXT.test(a.text));
  if (labelled) return stripTracking(labelled.href);
  const post = usable.find((a) => POST_URL.test(a.href));
  return post ? stripTracking(post.href) : null;
}

function stripTracking(href: string): string {
  try {
    const url = new URL(href);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|token$|r$|s$|triedRedirect$|isFreemail$|publication_id$|post_id$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return href;
  }
}
