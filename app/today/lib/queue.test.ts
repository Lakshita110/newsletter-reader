import { describe, expect, it } from "vitest";
import type { InboxItem } from "@/app/lib/feed-types";
import { buildTodayQueue, interleave, MAX_UNPICKED_STORIES, readingOrder, TOP_STORIES_FIRST } from "./queue";

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

const ids = (list: InboxItem[]) => list.map((i) => i.id);

describe("buildTodayQueue", () => {
  it("weaves stories and recent newsletters into one feed, a story first", () => {
    const q = build(
      [
        item("story-new", "rss", hoursAgo(1)),
        item("nl-new", "gmail", hoursAgo(2)),
        item("story-picked", "rss", hoursAgo(9)),
        item("nl-yesterday", "gmail", hoursAgo(30)),
      ],
      { recommendedIds: ["story-picked"] }
    );
    expect(ids(q.feed)).toEqual(["story-picked", "nl-new", "story-new", "nl-yesterday"]);
  });

  it("keeps older newsletters out of the feed but in the Newsletters view for a month", () => {
    const q = build([
      item("nl-today", "gmail", hoursAgo(3)),
      item("nl-last-week", "gmail", daysAgo(6)),
      item("nl-old", "gmail", daysAgo(40)),
    ]);
    expect(ids(q.feed)).toEqual(["nl-today"]);
    expect(ids(q.newsletters)).toEqual(["nl-today", "nl-last-week"]);
    expect(ids(readingOrder(q, "newsletters"))).toEqual(["nl-today", "nl-last-week"]);
  });

  it("leads with the most widely covered story, even one that broke after the ranking", () => {
    const q = build(
      [
        item("pick-a", "rss", hoursAgo(5), { coverage: 1 }),
        item("pick-b", "rss", hoursAgo(6), { coverage: 0 }),
        item("breaking", "rss", hoursAgo(1), { coverage: 4 }),
      ],
      { recommendedIds: ["pick-a", "pick-b"] }
    );
    expect(ids(q.feed)).toEqual(["breaking", "pick-a", "pick-b"]);
  });

  it("orders only the first few stories by coverage, then follows the ranker", () => {
    const picks = Array.from({ length: TOP_STORIES_FIRST + 2 }, (_, i) =>
      item(`p${i}`, "rss", hoursAgo(i + 1), { coverage: i === TOP_STORIES_FIRST + 1 ? 9 : 0 })
    );
    const q = build(picks, { recommendedIds: ids(picks) });
    expect(q.feed[0].id).toBe(`p${TOP_STORIES_FIRST + 1}`);
    expect(ids(q.feed).slice(TOP_STORIES_FIRST)).toEqual([`p${TOP_STORIES_FIRST - 1}`, `p${TOP_STORIES_FIRST}`]);
  });

  it("keeps in-progress above the feed, saved in its own list, and drops read and overflow items", () => {
    const q = build(
      [
        item("n-new", "gmail", daysAgo(0)),
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
    expect(ids(q.continue)).toEqual(["n-progress"]);
    expect(ids(q.feed)).toEqual(["r-1", "n-new"]);
    expect(ids(q.saved)).toEqual(["n-saved"]);
    expect(ids(readingOrder(q, "today"))).toEqual(["n-progress", "r-1", "n-new"]);
  });

  it("shows a ranked story even if it was marked overflow", () => {
    const q = build([item("ov", "rss", daysAgo(0), { isOverflow: true })], { recommendedIds: ["ov"] });
    expect(ids(q.feed)).toEqual(["ov"]);
  });

  it("caps unpicked stories", () => {
    const stories = Array.from({ length: MAX_UNPICKED_STORIES + 5 }, (_, i) => item(`r${i}`, "rss", hoursAgo(i)));
    expect(build(stories).feed).toHaveLength(MAX_UNPICKED_STORIES);
  });

  it("folds unpicked stories a newsletter already covered, but never a ranker pick", () => {
    const covered = { byId: "g1", publicationName: "Stratechery", subject: "x", matched: ["Nvidia", "China"] };
    const q = build(
      [
        item("r-a", "rss", daysAgo(0), { coveredBy: covered }),
        item("r-b", "rss", daysAgo(0)),
        item("r-picked", "rss", daysAgo(0), { coveredBy: covered }),
      ],
      { recommendedIds: ["r-picked"] }
    );
    expect(ids(q.feed)).toEqual(["r-picked", "r-b"]);
    expect(ids(q.covered)).toEqual(["r-a"]);
  });
});

describe("interleave", () => {
  it("alternates, then appends the rest of the longer list", () => {
    expect(interleave<number | string>([1, 2, 3], ["a"])).toEqual([1, "a", 2, 3]);
    expect(interleave([], ["a", "b"])).toEqual(["a", "b"]);
  });
});
