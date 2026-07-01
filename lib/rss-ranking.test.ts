import { afterEach, describe, expect, it, vi } from "vitest";
import type { RankingItem } from "./rss-ranking";

// rss-ranking.ts transitively imports rss-helpers -> prisma, which needs a
// generated @prisma/client. diversityTrim is a pure function with no DB
// access, so stub the prisma module out rather than requiring a real client
// just to load it under test.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { diversityTrim } = await import("./rss-ranking");

function item(id: string, sourceName: string): RankingItem {
  return {
    id,
    title: id,
    snippet: "",
    author: null,
    sourceName,
    publishedAtIso: "2026-01-01T00:00:00.000Z",
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("diversityTrim", () => {
  it("returns the AI's own ranked ids unchanged when already within cap", () => {
    const items = [item("a", "Source A"), item("b", "Source B")];
    expect(diversityTrim(["a", "b"], items, 5)).toEqual(["a", "b"]);
  });

  it("drops ids the AI referenced that aren't in the candidate pool", () => {
    const items = [item("a", "Source A")];
    // "ghost" has no matching RankingItem (e.g. item was pruned after ranking) and
    // must never surface as a "recommended" id with no backing item or reason.
    expect(diversityTrim(["a", "ghost"], items, 5)).toEqual(["a"]);
  });

  it("dedupes repeated ids from the AI output", () => {
    const items = [item("a", "Source A"), item("b", "Source B")];
    expect(diversityTrim(["a", "a", "b"], items, 5)).toEqual(["a", "b"]);
  });

  it("never backfills with un-reasoned filler beyond the AI's own picks", () => {
    // Only 2 AI picks exist even though cap is 5 — the old backfill/diversity
    // code padded this out with un-reasoned candidates from the wider pool.
    // The trim must only ever return ids the AI actually ranked.
    const items = [item("a", "Source A"), item("b", "Source B"), item("c", "Source C")];
    expect(diversityTrim(["a", "b"], items, 5)).toEqual(["a", "b"]);
  });

  it("round-robins across publishers instead of letting one dominate the cap", () => {
    // Ranked best-to-worst, but source A happens to sweep the top slots.
    const items = [
      item("a1", "Source A"),
      item("a2", "Source A"),
      item("a3", "Source A"),
      item("b1", "Source B"),
      item("b2", "Source B"),
      item("c1", "Source C"),
    ];
    const rankedIds = ["a1", "a2", "a3", "b1", "b2", "c1"];
    const result = diversityTrim(rankedIds, items, 3);
    // Smallest max-per-source that fills the cap with 3 sources is 1 each.
    expect(result).toEqual(["a1", "b1", "c1"]);
  });

  it("raises the per-source allowance only as far as needed to fill the cap", () => {
    const items = [
      item("a1", "Source A"),
      item("a2", "Source A"),
      item("a3", "Source A"),
      item("a4", "Source A"),
      item("b1", "Source B"),
    ];
    const rankedIds = ["a1", "a2", "a3", "a4", "b1"];
    // Only 2 sources for a cap of 4: one source must contribute more than
    // once, but it should still take B's single item before doubling up A.
    const result = diversityTrim(rankedIds, items, 4);
    expect(result).toEqual(["a1", "b1", "a2", "a3"]);
  });

  it("honors RSS_MAX_PER_SOURCE even if it leaves the feed short of cap", () => {
    vi.stubEnv("RSS_MAX_PER_SOURCE", "1");
    const items = [
      item("a1", "Source A"),
      item("a2", "Source A"),
      item("b1", "Source B"),
      item("b2", "Source B"),
    ];
    // Cap asks for 3, but a hard 1-per-source allowance across 2 sources can
    // only ever produce 2 — the trim must respect the env cap over filling
    // the requested cap.
    const result = diversityTrim(["a1", "a2", "b1", "b2"], items, 3);
    expect(result).toEqual(["a1", "b1"]);
  });
});
