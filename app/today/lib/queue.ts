import type { FeedReadStatus, InboxItem } from "@/app/lib/feed-types";

export type QueueSection = "continue" | "feed" | "more" | "covered" | "newsletters" | "saved";

export type QueueInput = {
  items: InboxItem[];
  statusById: Record<string, FeedReadStatus>;
  savedById: Record<string, boolean>;
  /** Story ids the ranker picked for today, best first. */
  recommendedIds: string[];
  now?: Date;
};

export type TodayQueue = Record<QueueSection, InboxItem[]>;

/**
 * Unread newsletters this recent are mixed into Today's feed (newest
 * TODAY_NEWSLETTER_LIMIT of them). A week, not two days: Stratechery and The
 * Pragmatic Engineer skip days (holidays especially), and a two-day window
 * made her paid subscriptions vanish from Today while still unread.
 */
export const FEED_NEWSLETTER_HOURS = 7 * 24;
/** The Newsletters tab keeps unread issues this long, for sit-down reading. */
export const NEWSLETTER_WINDOW_DAYS = 30;
/** RSS stories the ranker didn't pick are capped, so the list stays finishable. */
export const MAX_UNPICKED_STORIES = 12;
/** How many stories are ordered by coverage (how many sources run them) before ranker order takes over. */
export const TOP_STORIES_FIRST = 5;
/**
 * Today is meant to be glanced at and finished. Past this many stories the
 * rest are folded under "More stories" (still one tap away, never dropped).
 */
export const TODAY_STORY_LIMIT = 12;
/** No single outlet (a busy NYT or TechCrunch feed) takes more than this many of Today's stories. */
export const MAX_STORIES_PER_SOURCE = 3;
/** Newest newsletters woven into Today; the rest wait in the Newsletters tab. */
export const TODAY_NEWSLETTER_LIMIT = 6;

/** Email newsletters and posts from newsletter-style RSS feeds are read the same way. */
export function isNewsletter(item: InboxItem): boolean {
  return item.sourceKind === "gmail" || Boolean(item.longform);
}

/**
 * Build the two reading views from one pass over her items.
 *
 * Today ("feed") is one list to glance at: the day's stories and the last week's
 * unread newsletters woven together, a story first, so the biggest news
 * leads and newsletters are never buried under thirty headlines (or the
 * reverse). Stories are ordered with the most widely covered first (counted
 * at load time, so news that broke after the last ranking still leads), then
 * the ranker's order, then a capped number of unpicked stories. Only the
 * best TODAY_STORY_LIMIT are shown (at most MAX_STORIES_PER_SOURCE from one
 * outlet) and only the newest few newsletters; the rest of the stories fold
 * under "More stories", and every newsletter stays in the Newsletters tab.
 *
 * Newsletters is the long-form view: every unfinished issue from the last month,
 * newest first, for when she has time to sit down and read.
 *
 * - Opened items stay in place until she marks them done or saves them. Only
 *   a half-read piece that has aged out of the feed shows in "Continue reading".
 * - Unpicked stories a newsletter already covered are folded, not dropped.
 * - Saved is its own tab and never auto-expires.
 */
export function buildTodayQueue({
  items,
  statusById,
  savedById,
  recommendedIds,
  now = new Date(),
}: QueueInput): TodayQueue {
  const newsletterCutoff = now.getTime() - NEWSLETTER_WINDOW_DAYS * 86_400_000;
  const feedCutoff = now.getTime() - FEED_NEWSLETTER_HOURS * 3_600_000;
  const time = (item: InboxItem) => new Date(item.date).getTime() || 0;
  const rank = new Map(recommendedIds.map((id, i) => [id, i]));

  const queue: TodayQueue = { continue: [], feed: [], more: [], covered: [], newsletters: [], saved: [] };
  const picked: InboxItem[] = [];
  const unpicked: InboxItem[] = [];
  const seen = new Set<string>();
  const inProgress: InboxItem[] = [];

  for (const item of [...items].sort((a, b) => time(b) - time(a))) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const status = statusById[item.id] ?? "unread";
    if (savedById[item.id]) {
      queue.saved.push(item);
      continue;
    }
    if (status === "read") continue;
    // Opening an item doesn't move it: it stays where it was (with an
    // in-progress dot) until she marks it done or saves it. Only items that
    // no longer have a place in Today land in "Continue reading" below.
    if (status === "in-progress") inProgress.push(item);
    if (isNewsletter(item)) {
      if (time(item) >= newsletterCutoff) queue.newsletters.push(item);
    } else if (rank.has(item.id)) picked.push(item);
    else if (item.sourceKind === "rss" && !item.isOverflow) unpicked.push(item);
  }

  picked.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const extras = unpicked.slice(0, MAX_UNPICKED_STORIES);
  // The ranker's picks are always shown, even if a newsletter touched on the
  // same news. Only unpicked extras get folded.
  const lead = [...picked, ...extras.filter((item) => !item.coveredBy)];
  const top = lead
    .map((item, order) => ({ item, order }))
    .sort((a, b) => (b.item.coverage ?? 0) - (a.item.coverage ?? 0) || a.order - b.order)
    .slice(0, TOP_STORIES_FIRST)
    .map(({ item }) => item);
  const topIds = new Set(top.map((item) => item.id));
  const stories = [...top, ...picked.filter((item) => !topIds.has(item.id))];
  for (const item of extras) {
    if (topIds.has(item.id)) continue;
    if (item.coveredBy) queue.covered.push(item);
    else stories.push(item);
  }

  // Cap the visible list: best stories first, a few per outlet, the rest folded.
  const shown: InboxItem[] = [];
  const perSource = new Map<string, number>();
  for (const item of stories) {
    const used = perSource.get(item.publicationKey) ?? 0;
    if (shown.length < TODAY_STORY_LIMIT && used < MAX_STORIES_PER_SOURCE) {
      shown.push(item);
      perSource.set(item.publicationKey, used + 1);
    } else {
      queue.more.push(item);
    }
  }

  const recentNewsletters = queue.newsletters
    .filter((item) => time(item) >= feedCutoff)
    .slice(0, TODAY_NEWSLETTER_LIMIT);
  queue.feed = interleave(shown, recentNewsletters);

  const placed = new Set([...queue.feed, ...queue.more, ...queue.covered].map((item) => item.id));
  queue.continue = inProgress.filter((item) => !placed.has(item.id));
  return queue;
}

/** a1, b1, a2, b2, …, then whatever is left of the longer list. */
export function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

/** Reading order used for "Done → next" inside the reader, per tab. */
export function readingOrder(queue: TodayQueue, tab: "today" | "newsletters" | "saved"): InboxItem[] {
  if (tab === "saved") return queue.saved;
  if (tab === "newsletters") return queue.newsletters;
  // Folded "More stories" are left out: they don't count toward "N to read" or Mark all read.
  return [...queue.continue, ...queue.feed];
}
