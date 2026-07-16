import { describe, expect, it, vi } from "vitest";
import type { RankingCandidate } from "./rss-candidates";

const findFirst = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { userRssDailyRankSnapshot: { findFirst } },
}));

const { getLatestRankedIds, selectRankedIds } = await import("./rank-snapshot");

function candidate(id: string): RankingCandidate {
  return {
    sourceId: "src",
    sourceName: "Source",
    dedupKey: `key:${id}`,
    item: { title: id, snippet: null, author: null, publishedAt: null, createdAt: new Date() },
    feedItem: {
      id,
      sourceKind: "rss",
      subject: id,
      from: "Source",
      date: new Date().toISOString(),
      snippet: "",
      publicationName: "Source",
      publicationKey: "rss:src",
    },
    sortTimeMs: 0,
  };
}

describe("getLatestRankedIds", () => {
  it("returns null/empty when cron has never ranked this user", async () => {
    findFirst.mockResolvedValueOnce(null);
    const result = await getLatestRankedIds({ userId: "u1", sortedFallback: [candidate("rss:a")], cap: 5 });
    expect(result).toEqual({
      selectedRankIds: null,
      recommendedRankIds: [],
      rankReasons: {},
      status: null,
      rankedAt: null,
    });
  });

  it("passes through an AI_SUCCESS snapshot whose ids are all still in the current pool", async () => {
    const updatedAt = new Date("2026-07-01T12:00:00.000Z");
    findFirst.mockResolvedValueOnce({
      rankedItemIds: ["rss:a", "rss:b"],
      rankReasons: { "rss:a": "reason a", "rss:b": "reason b" },
      status: "AI_SUCCESS",
      updatedAt,
    });
    const sortedFallback = [candidate("rss:a"), candidate("rss:b")];
    const result = await getLatestRankedIds({ userId: "u1", sortedFallback, cap: 5 });
    expect(result.selectedRankIds).toEqual(["rss:a", "rss:b"]);
    expect(result.recommendedRankIds).toEqual(["rss:a", "rss:b"]);
    expect(result.status).toBe("AI_SUCCESS");
    expect(result.rankedAt).toBe(updatedAt.toISOString());
  });

  it("drops recommended ids that are no longer in the pool (read or deleted since) without zeroing the rest", async () => {
    findFirst.mockResolvedValueOnce({
      rankedItemIds: ["rss:a", "rss:b", "rss:c"],
      rankReasons: { "rss:a": "reason a", "rss:b": "reason b", "rss:c": "reason c" },
      status: "AI_SUCCESS",
      updatedAt: new Date("2026-07-01T12:00:00.000Z"),
    });
    // "rss:b" has since been read/deleted and is no longer in today's pool.
    const sortedFallback = [candidate("rss:a"), candidate("rss:c")];
    const result = await getLatestRankedIds({ userId: "u1", sortedFallback, cap: 5 });
    expect(result.recommendedRankIds).toEqual(["rss:a", "rss:c"]);
  });

  it("never recommends from a FALLBACK_DETERMINISTIC snapshot even if ids overlap the pool", async () => {
    findFirst.mockResolvedValueOnce({
      rankedItemIds: ["rss:a"],
      rankReasons: {},
      status: "FALLBACK_DETERMINISTIC",
      updatedAt: new Date("2026-07-01T12:00:00.000Z"),
    });
    const result = await getLatestRankedIds({ userId: "u1", sortedFallback: [candidate("rss:a")], cap: 5 });
    expect(result.recommendedRankIds).toEqual([]);
    expect(result.selectedRankIds).toEqual(["rss:a"]);
  });
});

describe("selectRankedIds", () => {
  it("keeps only allowed ids, deduped, capped", () => {
    const pool = [candidate("rss:a"), candidate("rss:b")];
    expect(selectRankedIds(["rss:a", "rss:ghost", "rss:a", "rss:b"], pool, 1)).toEqual(["rss:a"]);
  });

  it("backfills from the fallback order when short of cap and backfill is requested", () => {
    const pool = [candidate("rss:a"), candidate("rss:b"), candidate("rss:c")];
    expect(selectRankedIds(["rss:a"], pool, 3, { backfill: true })).toEqual(["rss:a", "rss:b", "rss:c"]);
  });

  it("does not backfill by default", () => {
    const pool = [candidate("rss:a"), candidate("rss:b")];
    expect(selectRankedIds(["rss:a"], pool, 3)).toEqual(["rss:a"]);
  });
});
