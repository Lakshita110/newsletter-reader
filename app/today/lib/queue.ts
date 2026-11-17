import type { FeedReadStatus, InboxItem } from "@/app/lib/feed-types";

export type QueueSection = "continue" | "feed" | "covered" | "saved";

export type QueueInput = {
  items: InboxItem[];
  statusById: Record<string, FeedReadStatus>;
  savedById: Record<string, boolean>;
  /** Ids the ranker picked for today (newsletters and stories alike), best first. */
  recommendedIds: string[];
  now?: Date;
};

export type TodayQueue = Record<QueueSection, InboxItem[]>;

/** Newsletters older than this drop out of the feed (still in Saved if saved). */
export const NEWSLETTER_WINDOW_DAYS = 14;
/** RSS stories the ranker didn't pick are capped, so the feed stays finishable. */
export const MAX_UNPICKED_STORIES = 12;

/**
 * Build the one feed: everything unread, in a single ranked list.
 *
 * Design choices:
 * - One list, not "newsletters" and "stories" sections. The ranker sees both
 *   kinds together (lib/rss-candidates.ts), so its order is the feed order.
 * - Items the ranker picked come first, in its order. Everything else follows
 *   newest first: every recent newsletter (she subscribed to each one, so
 *   none are hidden) and a capped number of RSS stories.
 * - "In progress" sits above the feed so a half-read piece is never buried.
 * - "Done" reuses the read state, so it also feeds the ranker's taste profile.
 * - Saved is its own tab and never auto-expires.
 */
export function buildTodayQueue({
  items,
  statusById,
  savedById,
  recommendedIds,
  now = new Date(),
}: QueueInput): TodayQueue {
  const cutoff = now.getTime() - NEWSLETTER_WINDOW_DAYS * 86_400_000;
  const time = (item: InboxItem) => new Date(item.date).getTime() || 0;
  const rank = new Map(recommendedIds.map((id, i) => [id, i]));

  const queue: TodayQueue = { continue: [], feed: [], covered: [], saved: [] };
  const picked: InboxItem[] = [];
  const unpickedNewsletters: InboxItem[] = [];
  const unpickedStories: InboxItem[] = [];
  const seen = new Set<string>();

  for (const item of [...items].sort((a, b) => time(b) - time(a))) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const status = statusById[item.id] ?? "unread";
    if (savedById[item.id]) {
      queue.saved.push(item);
      continue;
    }
    if (status === "read") continue;
    if (status === "in-progress") {
      queue.continue.push(item);
      continue;
    }
    if (rank.has(item.id)) picked.push(item);
    else if (item.sourceKind === "rss") {
      if (!item.isOverflow) unpickedStories.push(item);
    } else if (time(item) >= cutoff) unpickedNewsletters.push(item);
  }

  picked.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const unpicked = [...unpickedNewsletters, ...unpickedStories.slice(0, MAX_UNPICKED_STORIES)].sort(
    (a, b) => time(b) - time(a)
  );
  // Stories a newsletter already covered are folded away rather than
  // dropped: still one tap away, but they don't count toward "to read".
  for (const item of [...picked, ...unpicked]) {
    (item.coveredBy ? queue.covered : queue.feed).push(item);
  }
  return queue;
}

/** Reading order used for "Done → next" inside the reader. */
export function flattenQueue(queue: TodayQueue, includeSaved = false): InboxItem[] {
  return [...queue.continue, ...queue.feed, ...(includeSaved ? queue.saved : [])];
}
