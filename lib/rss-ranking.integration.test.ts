import { afterEach, describe, expect, it, vi } from "vitest";
import type { RankingItem } from "./rss-ranking";

// Unlike rss-ranking.test.ts, this file does NOT mock rss-ai-ranker —
// it exercises the real parsePicks + rankItemsForDailyCap +
// computeDailyRankedSelection pipeline end to end, with only the OpenRouter
// `fetch` call mocked. This is what actually proves the truncation fix: a
// unit test on parsePicks alone can't catch a regression introduced in how
// computeDailyRankedSelection wires the result back together.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { computeDailyRankedSelection } = await import("./rss-ranking");

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

const readProfile = {
  topPublications: [],
  avgCompletionPct: 0,
  recentReadCount7d: 0,
  preferenceSummary: [],
  customPrompt: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("computeDailyRankedSelection (real ranker pipeline)", () => {
  it("recovers every id with its reason from a mid-list truncated OpenRouter response", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const items = [item("rss:a", "Source A"), item("rss:b", "Source B"), item("rss:c", "Source C")];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "length",
              message: {
                // Truncated mid-third-pick, exactly the failure mode that
                // used to desync ids from reasons under the old
                // {"ids":[...],"reasons":{...}} wire format.
                content:
                  '{"picks":[{"id":"rss:a","reason":"strong tech pick"},{"id":"rss:b","reason":"fresh culture piece"},{"id":"rss:c","reason":"deeper read on cli',
              },
            },
          ],
        }),
      })
    );

    const result = await computeDailyRankedSelection({
      userId: "u1",
      dayKey: "2026-01-01-integration",
      cap: 5,
      rankedItems: items,
      readProfile,
    });

    expect(result.status).toBe("AI_SUCCESS");
    // The truncated third pick is dropped entirely (never a bare id).
    expect(result.selectedIds).toEqual(["rss:a", "rss:b"]);
    expect(result.recommendedIds).toEqual(["rss:a", "rss:b"]);
    expect(result.rankReasons).toEqual({
      "rss:a": "strong tech pick",
      "rss:b": "fresh culture piece",
    });
    // Every recommended id has a reason — the actual invariant being tested.
    for (const id of result.recommendedIds) {
      expect(result.rankReasons[id]).toBeTruthy();
    }
  });

  it("falls back to deterministic selection when OpenRouter returns unusable output", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const items = [item("rss:a", "Source A"), item("rss:b", "Source B")];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ finish_reason: "stop", message: { content: "not json at all" } }],
        }),
      })
    );

    const result = await computeDailyRankedSelection({
      userId: "u1",
      dayKey: "2026-01-01-integration-fallback",
      cap: 5,
      rankedItems: items,
      readProfile,
    });

    expect(result.status).toBe("FALLBACK_DETERMINISTIC");
    expect(result.selectedIds).toEqual(["rss:a", "rss:b"]);
    expect(result.recommendedIds).toEqual([]);
  });
});
