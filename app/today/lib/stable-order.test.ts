import { describe, expect, it } from "vitest";
import type { InboxItem } from "@/app/lib/feed-types";
import { applyFrozenOrder, freezeOrder } from "./stable-order";
import type { TodayQueue } from "./queue";

const item = (id: string): InboxItem => ({
  id,
  subject: id,
  from: "x",
  date: "2026-11-27T10:00:00Z",
  snippet: "",
  publicationName: "P",
  publicationKey: `p-${id}`,
});
const queue = (feed: string[], more: string[] = [], newsletters: string[] = []): TodayQueue => ({
  continue: [],
  feed: feed.map(item),
  more: more.map(item),
  covered: [],
  newsletters: newsletters.map(item),
  saved: [],
});
const open = (...ids: string[]) => new Map(ids.map((id) => [id, item(id)]));
const ids = (list: InboxItem[]) => list.map((i) => i.id);

describe("applyFrozenOrder", () => {
  it("shows the fresh queue until the order is frozen", () => {
    const q = queue(["a", "b"]);
    expect(applyFrozenOrder(q, null, open("a", "b")).feed).toBe(q.feed);
  });

  it("keeps the loaded order when a reload re-ranks, and holds new items back", () => {
    const frozen = freezeOrder(queue(["a", "b", "c"]));
    const reloaded = queue(["new", "c", "a"], ["b"]);
    const stable = applyFrozenOrder(reloaded, frozen, open("a", "b", "c", "new"));
    expect(ids(stable.feed)).toEqual(["a", "b", "c"]);
    expect(ids(stable.more)).toEqual([]); // b stays in its spot, not duplicated below
    expect(stable.pending.feed).toBe(1);
  });

  it("removes only what she finished or saved, and Undo puts it back in place", () => {
    const frozen = freezeOrder(queue(["a", "b", "c"]));
    expect(ids(applyFrozenOrder(queue(["a", "c"]), frozen, open("a", "c")).feed)).toEqual(["a", "c"]);
    expect(ids(applyFrozenOrder(queue(["a", "b", "c"]), frozen, open("a", "b", "c")).feed)).toEqual(["a", "b", "c"]);
  });

  it("freezes the Newsletters list the same way", () => {
    const frozen = freezeOrder(queue([], [], ["n1", "n2"]));
    const stable = applyFrozenOrder(queue([], [], ["n3", "n2", "n1"]), frozen, open("n1", "n2", "n3"));
    expect(ids(stable.newsletters)).toEqual(["n1", "n2"]);
    expect(stable.pending.newsletters).toBe(1);
  });
});
