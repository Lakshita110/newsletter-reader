import type { FeedReadStatus, InboxItem } from "@/app/inbox/types";

export type QueueSection = "continue" | "newsletters" | "stories" | "saved";

export type QueueInput = {
  items: InboxItem[];
  statusById: Record<string, FeedReadStatus>;
  savedById: Record<string, boolean>;
  /** RSS ids the ranker picked for today, best first. */
  recommendedIds: string[];
  now?: Date;
};

export type TodayQueue = Record<QueueSection, InboxItem[]>;

/** Newsletters older than this drop out of Today (they're still in the archive views). */
export const NEWSLETTER_WINDOW_DAYS = 14;
/** Keep the stories list short: Today should feel finishable. */
export const MAX_STORIES = 12;

/**
 * Build the single "what should I read now" queue that replaces hopping
 * between the newsletter and RSS inboxes.
 *
 * Design choices:
 * - "Done" reuses the existing read state, so swiping something away in Today
 *   also clears it from the classic inboxes (and feeds the ranker's profile).
 * - Newsletters are things she chose and paid for, so all unread recent ones
 *   show; RSS only shows what the ranker picked, capped, to avoid a firehose.
 * - Saved items are their own section and are never auto-expired.
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
  const byNewest = (a: InboxItem, b: InboxItem) => time(b) - time(a);

  const queue: TodayQueue = { continue: [], newsletters: [], stories: [], saved: [] };
  const seen = new Set<string>();

  for (const item of [...items].sort(byNewest)) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const status = statusById[item.id] ?? "unread";
    if (savedById[item.id]) {
      // Saved = "read later": it lives in Saved until un-saved, read or not.
      queue.saved.push(item);
      continue;
    }
    if (status === "read") continue;
    if (status === "in-progress") {
      queue.continue.push(item);
      continue;
    }
    if (item.sourceKind !== "rss" && time(item) >= cutoff) queue.newsletters.push(item);
  }

  const rank = new Map(recommendedIds.map((id, i) => [id, i]));
  queue.stories = items
    .filter(
      (item) =>
        item.sourceKind === "rss" &&
        !item.isOverflow &&
        !savedById[item.id] &&
        (statusById[item.id] ?? "unread") === "unread"
    )
    .sort((a, b) => {
      const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return ra - rb || byNewest(a, b);
    })
    .slice(0, MAX_STORIES);

  return queue;
}

/** Reading order used for "Done → next" inside the reader. */
export function flattenQueue(queue: TodayQueue, includeSaved = false): InboxItem[] {
  return [
    ...queue.continue,
    ...queue.newsletters,
    ...queue.stories,
    ...(includeSaved ? queue.saved : []),
  ];
}
