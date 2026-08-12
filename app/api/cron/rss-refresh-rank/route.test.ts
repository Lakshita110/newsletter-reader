import { afterEach, describe, expect, it, vi } from "vitest";

// refreshTodaySnapshotForUser touches prisma, OpenRouter (via
// computeDailyRankedSelection), and rank-snapshot persistence — mock every
// dependency so this test exercises only the skip/never-downgrade decisions
// the cron route itself is responsible for.
const findUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: (...args: unknown[]) => findUnique(...args) } } }));

const buildRankingCandidates = vi.fn();
vi.mock("@/lib/rss-candidates", () => ({ buildRankingCandidates: (...args: unknown[]) => buildRankingCandidates(...args) }));

const computeDailyRankedSelection = vi.fn();
vi.mock("@/lib/rss-ranking", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rss-ranking")>("@/lib/rss-ranking");
  return {
    ...actual,
    computeDailyRankedSelection: (...args: unknown[]) => computeDailyRankedSelection(...args),
  };
});

vi.mock("@/lib/rss-read-profile", () => ({
  getUserRssReadProfile: vi.fn().mockResolvedValue({
    topPublications: [],
    avgCompletionPct: 0,
    recentReadCount7d: 0,
    preferenceSummary: [],
  }),
}));

const readValidRankSnapshot = vi.fn();
const persistRankSnapshot = vi.fn();
vi.mock("@/lib/rank-snapshot", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rank-snapshot")>("@/lib/rank-snapshot");
  return {
    ...actual,
    readValidRankSnapshot: (...args: unknown[]) => readValidRankSnapshot(...args),
    persistRankSnapshot: (...args: unknown[]) => persistRankSnapshot(...args),
  };
});

const { refreshTodaySnapshotForUser } = await import("./route");

function aiItem(id: string) {
  return { id, title: id, snippet: "", author: null, sourceName: "Source", publishedAtIso: "2026-01-01T00:00:00.000Z" };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("refreshTodaySnapshotForUser", () => {
  it("skips re-ranking (and persisting) when a valid snapshot already matches today's input", async () => {
    findUnique.mockResolvedValue({ rssRecommendationPrompt: null });
    const items = [aiItem("rss:a"), aiItem("rss:b")];
    buildRankingCandidates.mockResolvedValue({ aiItems: items, totalCap: 2 });
    // Fingerprint must match what buildRankInputFingerprint(dayKey, cap, prompt, items) produces.
    const { buildRankInputFingerprint } = await import("@/lib/rss-ranking");
    const fingerprint = buildRankInputFingerprint("2026-01-01", 2, "", items);
    readValidRankSnapshot.mockResolvedValue({
      status: "AI_SUCCESS",
      inputFingerprint: fingerprint,
      rankedItemIds: ["rss:a", "rss:b"],
    });

    const result = await refreshTodaySnapshotForUser("u1", "2026-01-01");

    expect(result.skipped).toBe(true);
    expect(result.status).toBe("AI_SUCCESS");
    expect(computeDailyRankedSelection).not.toHaveBeenCalled();
    expect(persistRankSnapshot).not.toHaveBeenCalled();
  });

  it("never downgrades an existing AI_SUCCESS snapshot to a fallback re-rank result", async () => {
    findUnique.mockResolvedValue({ rssRecommendationPrompt: null });
    const items = [aiItem("rss:a"), aiItem("rss:b"), aiItem("rss:c")];
    buildRankingCandidates.mockResolvedValue({ aiItems: items, totalCap: 3 });
    // Different fingerprint (existing snapshot ranked over fewer items) forces a re-rank attempt.
    readValidRankSnapshot.mockResolvedValue({
      status: "AI_SUCCESS",
      inputFingerprint: "stale-fingerprint",
      rankedItemIds: ["rss:a", "rss:b"],
      rankReasons: { "rss:a": "old reason a", "rss:b": "old reason b" },
    });
    // This attempt degrades to the deterministic fallback (e.g. rate limit).
    computeDailyRankedSelection.mockResolvedValue({
      selectedIds: ["rss:a", "rss:b", "rss:c"],
      recommendedIds: [],
      rankReasons: {},
      status: "FALLBACK_DETERMINISTIC",
      model: null,
      inputFingerprint: "new-fingerprint",
    });

    const result = await refreshTodaySnapshotForUser("u1", "2026-01-01");

    expect(result.skipped).toBe(true);
    expect(result.status).toBe("AI_SUCCESS");
    expect(persistRankSnapshot).not.toHaveBeenCalled();
  });

  it("persists a fresh AI_SUCCESS ranking when the input actually changed", async () => {
    findUnique.mockResolvedValue({ rssRecommendationPrompt: null });
    const items = [aiItem("rss:a"), aiItem("rss:b"), aiItem("rss:c")];
    buildRankingCandidates.mockResolvedValue({ aiItems: items, totalCap: 3 });
    readValidRankSnapshot.mockResolvedValue({
      status: "AI_SUCCESS",
      inputFingerprint: "stale-fingerprint",
      rankedItemIds: ["rss:a", "rss:b"],
    });
    computeDailyRankedSelection.mockResolvedValue({
      selectedIds: ["rss:a", "rss:b", "rss:c"],
      recommendedIds: ["rss:a", "rss:b", "rss:c"],
      rankReasons: { "rss:a": "a", "rss:b": "b", "rss:c": "c" },
      status: "AI_SUCCESS",
      model: "openai/gpt-4o-mini",
      inputFingerprint: "new-fingerprint",
    });

    const result = await refreshTodaySnapshotForUser("u1", "2026-01-01");

    expect(result.skipped).toBe(false);
    expect(result.status).toBe("AI_SUCCESS");
    expect(persistRankSnapshot).toHaveBeenCalledTimes(1);
    expect(persistRankSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", dayKey: "2026-01-01", status: "AI_SUCCESS", source: "CRON" })
    );
  });

  it("re-ranks and persists when there is no existing snapshot at all", async () => {
    findUnique.mockResolvedValue({ rssRecommendationPrompt: null });
    const items = [aiItem("rss:a")];
    buildRankingCandidates.mockResolvedValue({ aiItems: items, totalCap: 1 });
    readValidRankSnapshot.mockResolvedValue(null);
    computeDailyRankedSelection.mockResolvedValue({
      selectedIds: ["rss:a"],
      recommendedIds: ["rss:a"],
      rankReasons: { "rss:a": "a" },
      status: "AI_SUCCESS",
      model: "openai/gpt-4o-mini",
      inputFingerprint: "fp",
    });

    const result = await refreshTodaySnapshotForUser("u1", "2026-01-01");

    expect(result.skipped).toBe(false);
    expect(persistRankSnapshot).toHaveBeenCalledTimes(1);
  });
});
