import { describe, expect, it } from "vitest";
import type { InboxItem } from "@/app/inbox/types";
import { buildTodayQueue, flattenQueue, MAX_STORIES } from "./queue";

const now = new Date("2026-11-16T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

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

describe("buildTodayQueue", () => {
  it("folds stories a newsletter already covered", () => {
    const q = buildTodayQueue({
      items: [
        item("r-a", "rss", daysAgo(0), { coveredBy: { byId: "g1", publicationName: "Stratechery", subject: "x", matched: ["Nvidia", "China"] } }),
        item("r-b", "rss", daysAgo(0)),
      ],
      statusById: {},
      savedById: {},
      recommendedIds: [],
      now,
    });
    expect(q.stories.map((i) => i.id)).toEqual(["r-b"]);
    expect(q.covered.map((i) => i.id)).toEqual(["r-a"]);
    expect(flattenQueue(q).map((i) => i.id)).toEqual(["r-b"]);
  });

  it("sorts items into continue / newsletters / stories / saved", () => {
    const items = [
      item("n-new", "gmail", daysAgo(0)),
      item("n-old", "gmail", daysAgo(20)),
      item("n-read", "gmail", daysAgo(1)),
      item("n-progress", "gmail", daysAgo(3)),
      item("n-saved", "gmail", daysAgo(40)),
      item("r-1", "rss", daysAgo(0)),
      item("r-overflow", "rss", daysAgo(0), { isOverflow: true }),
    ];
    const q = buildTodayQueue({
      items,
      statusById: { "n-read": "read", "n-progress": "in-progress", "n-saved": "read" },
      savedById: { "n-saved": true },
      recommendedIds: [],
      now,
    });
    expect(q.continue.map((i) => i.id)).toEqual(["n-progress"]);
    expect(q.newsletters.map((i) => i.id)).toEqual(["n-new"]); // old + read excluded
    expect(q.stories.map((i) => i.id)).toEqual(["r-1"]); // overflow excluded
    expect(q.saved.map((i) => i.id)).toEqual(["n-saved"]); // saved survives read + age
  });

  it("orders stories by ranker pick, then recency, and caps them", () => {
    const items = Array.from({ length: MAX_STORIES + 5 }, (_, i) => item(`r${i}`, "rss", daysAgo(i / 10)));
    const q = buildTodayQueue({ items, statusById: {}, savedById: {}, recommendedIds: ["r9", "r3"], now });
    expect(q.stories.slice(0, 3).map((i) => i.id)).toEqual(["r9", "r3", "r0"]);
    expect(q.stories).toHaveLength(MAX_STORIES);
  });

  it("flattens in reading order without saved by default", () => {
    const q = buildTodayQueue({
      items: [item("a", "gmail", daysAgo(0)), item("b", "rss", daysAgo(0)), item("c", "gmail", daysAgo(1))],
      statusById: { c: "in-progress" },
      savedById: {},
      recommendedIds: [],
      now,
    });
    expect(flattenQueue(q).map((i) => i.id)).toEqual(["c", "a", "b"]);
  });
});
