import { describe, expect, it } from "vitest";
import { classifyReadStat, summarizeReadingSignals, type ReadStatRow } from "./reading-signals";

const at = (iso: string) => new Date(iso);
function row(extra: Partial<ReadStatRow> = {}): ReadStatRow {
  return {
    messageTitle: "Title",
    publicationName: "Pub",
    openCount: 0,
    totalSecondsRead: 0,
    completionPct: 0,
    firstOpenedAt: null,
    completedAt: null,
    savedAt: null,
    ...extra,
  };
}

describe("classifyReadStat", () => {
  it("counts a swipe that never opened the item as a skip", () => {
    expect(classifyReadStat(row({ completedAt: at("2026-11-27T10:00:00Z") }))).toBe("skipped");
  });

  it("recognizes old swipes, which were stored as an instant read", () => {
    const t = at("2026-11-20T10:00:00.000Z");
    expect(classifyReadStat(row({ openCount: 1, completionPct: 100, firstOpenedAt: t, completedAt: t }))).toBe(
      "skipped"
    );
  });

  it("counts opening, saving, or time in the reader as a read", () => {
    const opened = at("2026-11-27T09:00:00Z");
    const done = at("2026-11-27T09:20:00Z");
    expect(classifyReadStat(row({ openCount: 1, completionPct: 100, firstOpenedAt: opened, completedAt: done }))).toBe(
      "read"
    );
    expect(classifyReadStat(row({ openCount: 1, completionPct: 50, firstOpenedAt: opened }))).toBe("read");
    expect(classifyReadStat(row({ savedAt: opened, completedAt: done }))).toBe("read");
    expect(classifyReadStat(row({ totalSecondsRead: 90, completedAt: done }))).toBe("read");
  });

  it("gives no signal for an untouched row", () => {
    expect(classifyReadStat(row())).toBeNull();
  });
});

describe("summarizeReadingSignals", () => {
  const skip = (pub: string, title: string) =>
    row({ publicationName: pub, messageTitle: title, completedAt: at("2026-11-27T10:00:00Z") });
  const read = (pub: string, title: string) =>
    row({ publicationName: pub, messageTitle: title, openCount: 1, firstOpenedAt: at("2026-11-27T09:00:00Z") });

  it("lists reads and skips newest first, and flags sources she mostly skips", () => {
    const s = summarizeReadingSignals([
      skip("Daily Mail", "a"),
      read("FT", "Chip exports"),
      skip("Daily Mail", "b"),
      skip("Daily Mail", "c"),
      skip("FT", "d"),
    ]);
    expect(s.recentReads).toEqual(["FT | Chip exports"]);
    expect(s.recentSkips).toEqual(["Daily Mail | a", "Daily Mail | b", "Daily Mail | c", "FT | d"]);
    expect(s.oftenSkippedSources).toEqual([{ name: "Daily Mail", skipped: 3, read: 0 }]);
  });

  it("doesn't flag a source she reads as often as she skips", () => {
    const s = summarizeReadingSignals([
      skip("NYT", "a"),
      skip("NYT", "b"),
      skip("NYT", "c"),
      read("NYT", "d"),
      read("NYT", "e"),
      read("NYT", "f"),
    ]);
    expect(s.oftenSkippedSources).toEqual([]);
  });
});
