import { describe, expect, it } from "vitest";
import type { InboxItem } from "@/app/lib/feed-types";
import {
  buildTodayQueue,
  MAX_STORIES_PER_SOURCE,
  MAX_UNPICKED_STORIES,
  readingOrder,
  TODAY_NEWSLETTER_LIMIT,
  TODAY_STORY_LIMIT,
  importanceBoostHours,
  MAX_IMPORTANCE_BOOST_HOURS,
} from "./queue";

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
    // One outlet per item unless a test says otherwise, so the per-source cap only bites where intended.
    publicationKey: `pub-${id}`,
    ...extra,
  };
}

const build = (items: InboxItem[], extra: Partial<Parameters<typeof buildTodayQueue>[0]> = {}) =>
  buildTodayQueue({ items, statusById: {}, savedById: {}, recommendedIds: [], now, ...extra });

const ids = (list: InboxItem[]) => list.map((i) => i.id);

describe("buildTodayQueue", () => {
  it("is mostly newest first, with stories and newsletters in one list", () => {
    const q = build(
      [
        item("story-new", "rss", hoursAgo(1)),
        item("nl-new", "gmail", hoursAgo(2)),
        item("story-old", "rss", hoursAgo(9)),
        item("nl-yesterday", "gmail", hoursAgo(30)),
      ],
      { recommendedIds: ["story-old"] }
    );
    // story-old is a top pick (+2h): 7h "ago" still sorts after the newer items.
    expect(ids(q.feed)).toEqual(["story-new", "nl-new", "story-old", "nl-yesterday"]);
  });

  it("keeps a week of unread newsletters in Today, and a month in the Newsletters view", () => {
    const q = build([
      item("nl-today", "gmail", hoursAgo(3)),
      item("nl-thanksgiving", "gmail", daysAgo(3)),
      item("nl-two-weeks", "gmail", daysAgo(14)),
      item("nl-old", "gmail", daysAgo(40)),
    ]);
    expect(ids(q.feed)).toEqual(["nl-today", "nl-thanksgiving"]);
    expect(ids(q.newsletters)).toEqual(["nl-today", "nl-thanksgiving", "nl-two-weeks"]);
    expect(ids(readingOrder(q, "newsletters"))).toEqual(["nl-today", "nl-thanksgiving", "nl-two-weeks"]);
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

  it("lets an important story rise a few hours, but no further", () => {
    const q = build(
      [
        item("fresh-minor", "rss", hoursAgo(1)),
        item("big-news", "rss", hoursAgo(6), { coverage: 3 }), // +6h coverage +2h top pick = 8h
        item("old-big", "rss", hoursAgo(12), { coverage: 9 }), // capped at +8h: still behind
      ],
      { recommendedIds: ["big-news"] }
    );
    expect(ids(q.feed)).toEqual(["big-news", "fresh-minor", "old-big"]);
  });

  it("caps the boost and never boosts newsletters", () => {
    expect(importanceBoostHours(item("s", "rss", hoursAgo(1), { coverage: 9 }), 0)).toBe(MAX_IMPORTANCE_BOOST_HOURS);
    expect(importanceBoostHours(item("s", "rss", hoursAgo(1)), 7)).toBe(1);
    expect(importanceBoostHours(item("s", "rss", hoursAgo(1)), undefined)).toBe(0);
    expect(importanceBoostHours(item("n", "gmail", hoursAgo(1), { coverage: 9 }), 0)).toBe(0);
  });

  it("keeps opened items in place, saved in its own list, and drops read and overflow items", () => {
    const q = build(
      [
        item("n-new", "gmail", daysAgo(0)),
        item("n-read", "gmail", daysAgo(1)),
        item("n-progress", "gmail", daysAgo(3)),
        item("r-opened", "rss", hoursAgo(2)),
        item("n-progress-old", "gmail", daysAgo(10)),
        item("n-saved", "gmail", daysAgo(40)),
        item("r-1", "rss", daysAgo(0)),
        item("r-overflow", "rss", daysAgo(0), { isOverflow: true }),
      ],
      {
        statusById: {
          "n-read": "read",
          "n-progress": "in-progress",
          "r-opened": "in-progress",
          "n-progress-old": "in-progress",
          "n-saved": "read",
        },
        savedById: { "n-saved": true },
      }
    );
    // Opening doesn't move or remove anything; only a half-read issue that has
    // aged out of the feed is kept visible under "Continue reading".
    expect(ids(q.feed)).toEqual(["r-1", "n-new", "r-opened", "n-progress"]);
    expect(ids(q.continue)).toEqual(["n-progress-old"]);
    expect(ids(q.newsletters)).toEqual(["n-new", "n-progress", "n-progress-old"]);
    expect(ids(q.saved)).toEqual(["n-saved"]);
    expect(ids(readingOrder(q, "today"))).toEqual(["n-progress-old", "r-1", "n-new", "r-opened", "n-progress"]);
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

describe("keeping Today short", () => {
  it("shows the best stories up to the limit and folds the rest, out of the reading count", () => {
    const stories = Array.from({ length: TODAY_STORY_LIMIT + 4 }, (_, i) => item(`s${i}`, "rss", hoursAgo(1)));
    const q = build(stories, { recommendedIds: stories.map((s) => s.id) });
    expect(ids(q.feed)).toEqual(ids(stories.slice(0, TODAY_STORY_LIMIT)));
    expect(ids(q.more)).toEqual(ids(stories.slice(TODAY_STORY_LIMIT)));
    expect(readingOrder(q, "today")).toHaveLength(TODAY_STORY_LIMIT);
  });

  it("lets no single outlet take over the list", () => {
    const nyt = Array.from({ length: 5 }, (_, i) =>
      item(`nyt${i}`, "rss", hoursAgo(1), { publicationKey: "rss:nyt", coverage: 3 })
    );
    const other = item("ft", "rss", hoursAgo(2));
    const q = build([...nyt, other], { recommendedIds: [...ids(nyt), "ft"] });
    expect(ids(q.feed)).toEqual(["nyt0", "nyt1", "nyt2", "ft"].slice(0, MAX_STORIES_PER_SOURCE + 1));
    expect(ids(q.more)).toEqual(["nyt3", "nyt4"]);
  });

  it("weaves only the newest few newsletters into Today; all stay in Newsletters", () => {
    const letters = Array.from({ length: TODAY_NEWSLETTER_LIMIT + 2 }, (_, i) =>
      item(`nl${i}`, "gmail", hoursAgo(i + 1))
    );
    const q = build(letters);
    expect(ids(q.feed)).toEqual(ids(letters.slice(0, TODAY_NEWSLETTER_LIMIT)));
    expect(q.newsletters).toHaveLength(letters.length);
  });

  it("treats posts from newsletter-style RSS feeds as newsletters, not ranked news", () => {
    const essay = item("essay", "rss", daysAgo(9), { longform: true });
    const q = build([essay, item("fresh-essay", "rss", hoursAgo(3), { longform: true })]);
    expect(ids(q.newsletters)).toEqual(["fresh-essay", "essay"]);
    expect(ids(q.feed)).toEqual(["fresh-essay"]);
    expect(q.more).toEqual([]);
  });

  it("treats an issue as read or saved if she finished or saved any copy of it", () => {
    const q = build(
      [
        item("kept-1", "gmail", hoursAgo(1), { duplicateIds: ["hidden-1"] }),
        item("kept-2", "gmail", hoursAgo(2), { duplicateIds: ["hidden-2"] }),
      ],
      { statusById: { "hidden-1": "read" }, savedById: { "hidden-2": true } }
    );
    expect(ids(q.feed)).toEqual([]);
    expect(ids(q.saved)).toEqual(["kept-2"]);
  });
});
