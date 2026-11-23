import { describe, expect, it } from "vitest";
import type { InboxItem } from "@/app/lib/feed-types";
import { buildTodayQueue, flattenQueue, MAX_UNPICKED_STORIES, TOP_STORIES_FIRST } from "./queue";

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
  it("puts the top picks first, then newsletters (newest first), then the rest of the stories", () => {
    const picks = Array.from({ length: TOP_STORIES_FIRST + 1 }, (_, i) => item(`pick${i}`, "rss", hoursAgo(9 + i)));
    const q = build(
      [
        item("story-new", "rss", hoursAgo(1)),
        item("nl-new", "gmail", hoursAgo(2)),
        item("nl-older", "gmail", daysAgo(3)),
        ...picks,
      ],
      { recommendedIds: picks.map((p) => p.id) }
    );
    const topIds = picks.slice(0, TOP_STORIES_FIRST).map((p) => p.id);
    const lastPick = picks[TOP_STORIES_FIRST].id;
    expect(q.top.map((i) => i.id)).toEqual(topIds);
    expect(q.newsletters.map((i) => i.id)).toEqual(["nl-new", "nl-older"]);
    expect(q.stories.map((i) => i.id)).toEqual([lastPick, "story-new"]);
    expect(flattenQueue(q).map((i) => i.id)).toEqual([...topIds, "nl-new", "nl-older", lastPick, "story-new"]);
  });

  it("keeps in-progress above everything, saved in its own list, and drops read, old and overflow items", () => {
    const q = build(
      [
        item("n-new", "gmail", daysAgo(0)),
        item("n-old", "gmail", daysAgo(10)),
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
    expect(q.newsletters.map((i) => i.id)).toEqual(["n-new"]);
    expect(q.top.map((i) => i.id)).toEqual(["r-1"]);
    expect(q.saved.map((i) => i.id)).toEqual(["n-saved"]);
  });

  it("a ranked story is shown even if it was marked overflow", () => {
    const q = build([item("ov", "rss", daysAgo(0), { isOverflow: true })], { recommendedIds: ["ov"] });
    expect(q.top.map((i) => i.id)).toEqual(["ov"]);
  });

  it("caps unpicked stories but never hides recent newsletters", () => {
    const stories = Array.from({ length: MAX_UNPICKED_STORIES + 5 }, (_, i) => item(`r${i}`, "rss", hoursAgo(i)));
    const newsletters = Array.from({ length: 12 }, (_, i) => item(`n${i}`, "gmail", daysAgo(i / 2)));
    const q = build([...stories, ...newsletters]);
    // Before ranking, the newest unpicked stories stand in at the top.
    expect(q.top.length + q.stories.length).toBe(MAX_UNPICKED_STORIES);
    expect(q.top).toHaveLength(TOP_STORIES_FIRST);
    expect(q.newsletters).toHaveLength(12);
  });

  it("folds stories a newsletter already covered", () => {
    const q = build([
      item("r-a", "rss", daysAgo(0), {
        coveredBy: { byId: "g1", publicationName: "Stratechery", subject: "x", matched: ["Nvidia", "China"] },
      }),
      item("r-b", "rss", daysAgo(0)),
    ]);
    expect(q.top.map((i) => i.id)).toEqual(["r-b"]);
    expect(q.covered.map((i) => i.id)).toEqual(["r-a"]);
    expect(flattenQueue(q).map((i) => i.id)).toEqual(["r-b"]);
  });

  it("never folds a story the ranker picked, even if a newsletter mentioned it", () => {
    const q = build(
      [
        item("r-big", "rss", daysAgo(0), {
          coveredBy: { byId: "g1", publicationName: "The Economist Today", subject: "x", matched: ["NATO", "Ukraine"] },
        }),
      ],
      { recommendedIds: ["r-big"] }
    );
    expect(q.top.map((i) => i.id)).toEqual(["r-big"]);
    expect(q.covered).toEqual([]);
  });
});
