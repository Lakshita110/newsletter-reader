import type { FeedReadStatus, InboxItem } from "@/app/lib/feed-types";

export type QueueSection = "continue" | "newsletters" | "stories" | "covered" | "saved";

export type QueueInput = {
  items: InboxItem[];
  statusById: Record<string, FeedReadStatus>;
  savedById: Record<string, boolean>;
  /** Story ids the ranker picked for today, best first. */
  recommendedIds: string[];
  now?: Date;
};

export type TodayQueue = Record<QueueSection, InboxItem[]>;

/** Unread newsletters older than this drop out of Today (still in Saved if saved). */
export const NEWSLETTER_WINDOW_DAYS = 7;
/** RSS stories the ranker didn't pick are capped, so the list stays finishable. */
export const MAX_UNPICKED_STORIES = 12;

/**
 * Build Today: one scroll, newsletters first, then the day's top stories.
 *
 * Why newsletters lead (and aren't ranked): they're the writers she chose to
 * hear from, Pragmatic Engineer, Stratechery and her Substacks, and each
 * issue is worth opening. Mixing them into the story ranking let a so-so
 * news item push an issue down the list. So they sit on top, newest first.
 *
 * Stories follow in the ranker's order (which leads with the day's most
 * widely covered news, see lib/story-buzz.ts), then a capped number of
 * unpicked stories, newest first.
 *
 * - "In progress" sits above everything so a half-read piece is never buried.
 * - Stories a newsletter already covered are folded, not dropped.
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

  const queue: TodayQueue = { continue: [], newsletters: [], stories: [], covered: [], saved: [] };
  const picked: InboxItem[] = [];
  const unpicked: InboxItem[] = [];
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
    if (item.sourceKind === "gmail") {
      if (time(item) >= cutoff) queue.newsletters.push(item);
    } else if (rank.has(item.id)) picked.push(item);
    else if (item.sourceKind === "rss" && !item.isOverflow) unpicked.push(item);
  }

  picked.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  for (const item of [...picked, ...unpicked.slice(0, MAX_UNPICKED_STORIES)]) {
    (item.coveredBy ? queue.covered : queue.stories).push(item);
  }
  return queue;
}

/** Reading order used for "Done → next" inside the reader. */
export function flattenQueue(queue: TodayQueue, includeSaved = false): InboxItem[] {
  return [...queue.continue, ...queue.newsletters, ...queue.stories, ...(includeSaved ? queue.saved : [])];
}
