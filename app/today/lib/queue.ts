import type { FeedReadStatus, InboxItem } from "@/app/lib/feed-types";

export type QueueSection = "continue" | "top" | "newsletters" | "stories" | "covered" | "saved";

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
 * How many of the ranker's picks go above the newsletters. With a dozen or
 * more newsletters a day, stories placed after all of them were effectively
 * invisible; the day's biggest few news items belong at the very top.
 */
export const TOP_STORIES_FIRST = 5;

/**
 * Build Today: one scroll. The day's top few stories, then newsletters, then
 * the rest of the stories.
 *
 * The ranker leads with the day's most widely covered news (lib/story-buzz.ts),
 * so its first few picks open the page: the big headlines take seconds to
 * scan and shouldn't sit under a long list of newsletters.
 *
 * Newsletters come next, unranked and newest first: they're the writers she
 * chose to hear from, and mixing them into the story ranking let a so-so news
 * item push an issue down. The rest of the picks follow, then a capped
 * number of unpicked stories, newest first.
 *
 * - "In progress" sits above everything so a half-read piece is never buried.
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
  const cutoff = now.getTime() - NEWSLETTER_WINDOW_DAYS * 86_400_000;
  const time = (item: InboxItem) => new Date(item.date).getTime() || 0;
  const rank = new Map(recommendedIds.map((id, i) => [id, i]));

  const queue: TodayQueue = { continue: [], top: [], newsletters: [], stories: [], covered: [], saved: [] };
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
  const extras = unpicked.slice(0, MAX_UNPICKED_STORIES);
  // The ranker's picks are the day's top stories: always show them, even if
  // a newsletter touched on the same news. Only unpicked extras get folded.
  //
  // Top is ordered by how many of her sources run the story, ranker order
  // breaking ties. The ranking runs a few times a day, so news that breaks
  // after it isn't among the picks; counting coverage at load time still
  // puts the story everyone is running first (and fixes the rare ranker
  // misorder) without paying for another ranking call.
  const lead = [...picked, ...extras.filter((item) => !item.coveredBy)];
  const top = lead
    .map((item, order) => ({ item, order }))
    .sort((a, b) => (b.item.coverage ?? 0) - (a.item.coverage ?? 0) || a.order - b.order)
    .slice(0, TOP_STORIES_FIRST)
    .map(({ item }) => item);
  const topIds = new Set(top.map((item) => item.id));
  queue.top.push(...top);
  queue.stories.push(...picked.filter((item) => !topIds.has(item.id)));
  for (const item of extras) {
    if (topIds.has(item.id)) continue;
    (item.coveredBy ? queue.covered : queue.stories).push(item);
  }
  return queue;
}

/** Reading order used for "Done → next" inside the reader. */
export function flattenQueue(queue: TodayQueue, includeSaved = false): InboxItem[] {
  return [
    ...queue.continue,
    ...queue.top,
    ...queue.newsletters,
    ...queue.stories,
    ...(includeSaved ? queue.saved : []),
  ];
}
