import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/newsletter-sync", () => ({ getStoredNewsletterFeed: vi.fn() }));
const { buildRecap } = await import("./recap");
import type { FeedItem } from "./rss-candidates";
import type { RecapStat } from "./recap";

const now = new Date("2026-11-29T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 3600e3);
const stat = (id: string, pub: string, seconds: number, completedDaysAgo: number, kind = "gmail"): RecapStat => ({
  messageExternalId: id,
  messageTitle: `Title ${id}`,
  publicationName: pub,
  sourceKind: kind,
  totalSecondsRead: seconds,
  completedAt: daysAgo(completedDaysAgo),
});
const issue = (id: string, pub: string, ageDays: number): FeedItem => ({
  id,
  sourceKind: "gmail",
  subject: `Issue ${id}`,
  from: pub,
  date: daysAgo(ageDays).toISOString(),
  snippet: "",
  publicationName: pub,
  publicationKey: pub,
});

describe("buildRecap", () => {
  it("counts only time spent in the reader as reading; swipes are cleared", () => {
    const recap = buildRecap({
      now,
      stats: [stat("a", "Stratechery", 600, 1), stat("b", "Stratechery", 0, 2), stat("c", "BBC", 90, 3, "rss")],
      highlights: [],
      newsletters: [],
    });
    expect(recap.read.map((r) => r.id)).toEqual(["a", "c"]);
    expect(recap.minutesRead).toBe(12);
    expect(recap.clearedCount).toBe(1);
    expect(recap.topPublications).toEqual([
      { name: "BBC", count: 1 },
      { name: "Stratechery", count: 1 },
    ]);
  });

  it("leaves last month's reading out of the week but uses it to rank second-look picks", () => {
    const recap = buildRecap({
      now,
      stats: [stat("old1", "Pragmatic", 400, 20), stat("old2", "Pragmatic", 400, 25), stat("x", "Other", 400, 9)],
      highlights: [],
      newsletters: [
        issue("n-other", "Other", 1),
        issue("n-prag", "Pragmatic", 3),
        issue("n-new", "Unknown", 0),
        issue("too-old", "Pragmatic", 9),
        issue("old1", "Pragmatic", 5), // already read: not a second look
      ],
    });
    expect(recap.read).toEqual([]);
    expect(recap.secondLook.map((n) => n.id)).toEqual(["n-prag", "n-other", "n-new"]);
  });

  it("offers a newsletter she swiped away without reading", () => {
    const recap = buildRecap({
      now,
      stats: [stat("swiped", "Pragmatic", 0, 1)],
      highlights: [],
      newsletters: [issue("swiped", "Pragmatic", 1)],
    });
    expect(recap.clearedCount).toBe(1);
    expect(recap.secondLook.map((n) => n.id)).toEqual(["swiped"]);
  });
});
