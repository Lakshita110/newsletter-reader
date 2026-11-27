import type { InboxItem } from "@/app/lib/feed-types";
import type { TodayQueue } from "./queue";

/**
 * Keeps Today from reshuffling under her thumb.
 *
 * Once the page has loaded (or she has started touching it), the order of
 * the feed and the Newsletters list is frozen for the session. After that,
 * only her own actions change what's shown: finishing or saving an item
 * removes it, Undo puts it back in its old place. Anything that arrives or
 * gets re-ranked later waits behind a "N new" button, and Refresh applies it.
 *
 * The frozen order lives in sessionStorage so a trip into the reader and back
 * doesn't reshuffle either. It expires after a few hours, so the next
 * morning starts fresh.
 */
export type FrozenOrder = { feed: string[]; newsletters: string[]; at: number };

const STORAGE_KEY = "nr_today_frozen_order";
export const FROZEN_ORDER_MAX_AGE_MS = 3 * 60 * 60 * 1000;

export function freezeOrder(queue: TodayQueue, now = Date.now()): FrozenOrder {
  return { feed: queue.feed.map((i) => i.id), newsletters: queue.newsletters.map((i) => i.id), at: now };
}

export type StableQueue = TodayQueue & { pending: { feed: number; newsletters: number } };

/**
 * Lay the frozen order over a freshly built queue. `open` holds every item
 * she hasn't finished or saved (by id), so an item stays in its frozen spot
 * even if a re-rank moved it, and disappears only when she acts on it.
 */
export function applyFrozenOrder(
  queue: TodayQueue,
  frozen: FrozenOrder | null,
  open: Map<string, InboxItem>
): StableQueue {
  if (!frozen) return { ...queue, pending: { feed: 0, newsletters: 0 } };
  const keep = (ids: string[]) => ids.map((id) => open.get(id)).filter((item): item is InboxItem => Boolean(item));
  const feed = keep(frozen.feed);
  const newsletters = keep(frozen.newsletters);
  const inFeed = new Set(feed.map((i) => i.id));
  const frozenFeed = new Set(frozen.feed);
  const frozenNewsletters = new Set(frozen.newsletters);
  const notInFeed = (list: InboxItem[]) => list.filter((i) => !inFeed.has(i.id));
  return {
    ...queue,
    feed,
    newsletters,
    // A story frozen into the feed must not also show up in a fold below it.
    more: notInFeed(queue.more),
    covered: notInFeed(queue.covered),
    continue: notInFeed(queue.continue),
    pending: {
      feed: queue.feed.filter((i) => !frozenFeed.has(i.id)).length,
      newsletters: queue.newsletters.filter((i) => !frozenNewsletters.has(i.id)).length,
    },
  };
}

export function readFrozenOrder(now = Date.now()): FrozenOrder | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FrozenOrder;
    if (!Array.isArray(parsed.feed) || !Array.isArray(parsed.newsletters) || typeof parsed.at !== "number") return null;
    return now - parsed.at > FROZEN_ORDER_MAX_AGE_MS ? null : parsed;
  } catch (error) {
    console.warn("[today] could not read the saved order", error);
    return null;
  }
}

export function writeFrozenOrder(order: FrozenOrder | null) {
  try {
    if (order) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(order));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("[today] could not save the order", error);
  }
}
