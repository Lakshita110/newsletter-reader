import { describe, expect, it } from "vitest";
import type { InboxItem } from "@/app/lib/feed-types";
import { buildTodayQueue, flattenQueue, MAX_UNPICKED_STORIES } from "./queue";

const now = new Date("2026-11-16T12:00:00Z");
const hoursAgo = (n: number) => new Date(now.getTime() - n * 3_600_000).toISOString();
const daysAgo = (n: number) => hoursAgo(n * 24);

function item(id: string, kind: "gmail" | "rss", date: string, extra: Partial<InboxItem> = {}): InboxItem {
  return {
    id,
    sourceKind: kind,
    subject: id,
    from: "x",
    date,
    snippet: "",
    publicationName: "Pub",
    publicationKey: "pub",
    ...extra,
  };
}

const build = (items: InboxItem[], extra: Partial<Parameters<typeof buildTodayQueue>[0]> = {}) =>
  buildTodayQueue({ items, statusById: {}, savedById: {}, recommendedIds: [], now, ...extra });

describe("buildTodayQueue", () => {
  it("puts newsletters and stories in one feed: ranked picks first, then the rest newest first", () => {
    const q = build(
      [
        item("story-new", "rss", hoursAgo(1)),
        item("nl-new", "gmail", hoursAgo(2)),
        item("story-picked", "rss", hoursAgo(9)),
        item("nl-picked", "gmail", daysAgo(3)),
      ],
      { recommendedIds: ["nl-picked", "story-picked"] }
    );
    expect(q.feed.map((i) => i.id)).toEqual(["nl-picked", "story-picked", "story-new", "nl-new"]);
  });

  it("keeps in-progress above the feed, saved in its own list, and drops read, old and overflow items", () => {
    const q = build(
      [
        item("n-new", "gmail", daysAgo(0)),
        item("n-old", "gmail", daysAgo(20)),
        item("n-read", "gmail", daysAgo(1)),
        item("n-progress", "gmail", daysAgo(3)),
        item("n-saved", "gmail", daysAgo(40)),
        item("r-1", "rss", daysAgo(0)),
        item("r-overflow", "rss", daysAgo(0), { isOverflow: true }),
      ],
      {
        statusById: { "n-read": "read", "n-progress": "in-progress", "n-saved": "read" },
        savedById: { "n-saved": true },
      }
    );
    expect(q.continue.map((i) => i.id)).toEqual(["n-progress"]);
    expect(q.feed.map((i) => i.id).sort()).toEqual(["n-new", "r-1"]);
    expect(q.saved.map((i) => i.id)).toEqual(["n-saved"]);
  });

  it("a ranked pick is shown even if it's an older newsletter or an overflow story", () => {
    const q = build([item("old-nl", "gmail", daysAgo(20)), item("ov", "rss", daysAgo(0), { isOverflow: true })], {
      recommendedIds: ["ov", "old-nl"],
    });
    expect(q.feed.map((i) => i.id)).toEqual(["ov", "old-nl"]);
  });

  it("caps unpicked stories but never hides newsletters", () => {
    const stories = Array.from({ length: MAX_UNPICKED_STORIES + 5 }, (_, i) => item(`r${i}`, "rss", hoursAgo(i)));
    const newsletters = Array.from({ length: 15 }, (_, i) => item(`n${i}`, "gmail", daysAgo(i / 2)));
    const q = build([...stories, ...newsletters]);
    expect(q.feed.filter((i) => i.sourceKind === "rss")).toHaveLength(MAX_UNPICKED_STORIES);
    expect(q.feed.filter((i) => i.sourceKind === "gmail")).toHaveLength(15);
  });

  it("folds stories a newsletter already covered", () => {
    const q = build([
      item("r-a", "rss", daysAgo(0), {
        coveredBy: { byId: "g1", publicationName: "Stratechery", subject: "x", matched: ["Nvidia", "China"] },
      }),
      item("r-b", "rss", daysAgo(0)),
    ]);
    expect(q.feed.map((i) => i.id)).toEqual(["r-b"]);
    expect(q.covered.map((i) => i.id)).toEqual(["r-a"]);
    expect(flattenQueue(q).map((i) => i.id)).toEqual(["r-b"]);
  });

  it("flattens in reading order without saved by default", () => {
    const q = build([item("a", "gmail", daysAgo(0)), item("b", "rss", daysAgo(0.5)), item("c", "gmail", daysAgo(1))], {
      statusById: { c: "in-progress" },
    });
    expect(flattenQueue(q).map((i) => i.id)).toEqual(["c", "a", "b"]);
  });
});
