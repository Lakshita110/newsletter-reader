import { SMART_MODEL_CHAIN } from "./openrouter";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePicks, rankItemsForDailyCap, signalsSection, withMaxTokens } from "./rss-ai-ranker";

// The ranker prompt asks the model to emit, per selected item, one
// {"id":"rss:x","reason":"<=10 words"} object — an id (~10 tokens), a short
// reason (~12 tokens), plus the object's own braces/keys/quoting (~14
// tokens). If max_tokens is too small the response truncates mid-list
// (finish_reason="length") and loses trailing picks. This guards the budget
// against regressing to a size that only fits bare ids.
const TOKENS_PER_ITEM = 32;

describe("withMaxTokens", () => {
  it("leaves room for id+reason objects at a realistic daily cap", () => {
    const cap = 35;
    // The historical bug used cap*12, which only fit bare ids.
    expect(withMaxTokens(cap)).toBeGreaterThan(cap * 12);
    expect(withMaxTokens(cap)).toBeGreaterThanOrEqual(cap * TOKENS_PER_ITEM);
  });

  it("enforces a sensible floor for tiny caps", () => {
    expect(withMaxTokens(1)).toBe(512);
    expect(withMaxTokens(0)).toBe(512);
  });

  it("caps the budget so a huge cap cannot blow up output cost", () => {
    expect(withMaxTokens(1000)).toBe(4096);
  });

  it("scales with the cap between the floor and ceiling", () => {
    expect(withMaxTokens(50)).toBeGreaterThan(withMaxTokens(20));
  });
});

describe("parsePicks", () => {
  it("reads picks from a clean, well-formed envelope", () => {
    const content =
      '{"picks":[{"id":"rss:a","reason":"strong tech pick"},{"id":"rss:b","reason":"fresh culture piece"}]}';
    expect(parsePicks(content)).toEqual([
      { rawId: "rss:a", reason: "strong tech pick" },
      { rawId: "rss:b", reason: "fresh culture piece" },
    ]);
  });

  it("recovers complete picks when the output is truncated mid-list", () => {
    // finish_reason="length" cuts the blob before the closing braces (and mid
    // way through the final value), so JSON.parse of the whole thing fails.
    // Earlier complete picks must still survive, each with its own reason —
    // this is the case that used to desync ids from reasons.
    const truncated =
      '{"picks":[{"id":"rss:a","reason":"strong tech pick"},{"id":"rss:b","reason":"fresh culture piece"},{"id":"rss:c","reason":"deeper read on cli';
    expect(parsePicks(truncated)).toEqual([
      { rawId: "rss:a", reason: "strong tech pick" },
      { rawId: "rss:b", reason: "fresh culture piece" },
    ]);
  });

  it("recovers picks even when the model wraps output in a markdown fence", () => {
    const fenced = '```json\n{"picks":[{"id":"rss:a","reason":"timely and relevant"}]}\n```';
    expect(parsePicks(fenced)).toEqual([{ rawId: "rss:a", reason: "timely and relevant" }]);
  });

  it("recovers picks with reversed key order (reason before id)", () => {
    const reversed = '{"picks":[{"reason":"timely and relevant","id":"rss:a"}]}';
    expect(parsePicks(reversed)).toEqual([{ rawId: "rss:a", reason: "timely and relevant" }]);
  });

  it("drops a pick missing its reason instead of returning a bare id", () => {
    const noReason = '{"picks":[{"id":"rss:a"},{"id":"rss:b","reason":"fresh culture piece"}]}';
    expect(parsePicks(noReason)).toEqual([{ rawId: "rss:b", reason: "fresh culture piece" }]);
  });

  it("returns an empty list for empty content", () => {
    expect(parsePicks("")).toEqual([]);
  });
});

describe("rankItemsForDailyCap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("tells the model how widely each story is covered and to lead with big news", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: "stop",
            message: { content: '{"picks":[{"id":"rss:big","reason":"markets sell-off"}]}' },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await rankItemsForDailyCap({
      dayKey: "2026-11-21-coverage",
      cap: 5,
      items: [
        { id: "rss:big", title: "Stocks tumble", coverage: 4, publishedAtIso: "2026-11-21T00:00:00.000Z" },
        { id: "rss:odd", title: "Birdwatching", coverage: 0, publishedAtIso: "2026-11-21T00:00:00.000Z" },
      ],
    });

    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content as string;
    expect(prompt).toContain("id=rss:big\ncoverage=4");
    expect(prompt).toContain("Big news:");
    expect(prompt).toContain("Lead with the day's most important news");
  });

  it("still calls the AI (and gets reasons) when candidates already fit within the cap", async () => {
    // Previously this case skipped the AI call entirely and returned every id
    // with an empty reasons map, so "why?" pills never showed at all on a day
    // with few candidates. It must now go through the same ranking call as
    // any other day.
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: '{"picks":[{"id":"rss:within-cap-a","reason":"only candidate, still reasoned"}]}',
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await rankItemsForDailyCap({
      dayKey: "2026-07-01-within-cap-test",
      cap: 5,
      items: [
        {
          id: "rss:within-cap-a",
          title: "Only candidate",
          publishedAtIso: "2026-07-01T00:00:00.000Z",
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ids: ["rss:within-cap-a"],
      reasons: { "rss:within-cap-a": "only candidate, still reasoned" },
      model: SMART_MODEL_CHAIN[0],
    });
  });

  it("never returns an id without a matching reason, even from a truncated response", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: "length",
            message: {
              content: '{"picks":[{"id":"rss:a","reason":"strong tech pick"},{"id":"rss:b","reason":"fresh cult',
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await rankItemsForDailyCap({
      dayKey: "2026-07-01-truncated-test",
      cap: 5,
      items: [
        { id: "rss:a", title: "A", publishedAtIso: "2026-07-01T00:00:00.000Z" },
        { id: "rss:b", title: "B", publishedAtIso: "2026-07-01T00:00:00.000Z" },
      ],
    });

    expect(result?.ids).toEqual(["rss:a"]);
    expect(result?.ids.every((id) => Boolean(result?.reasons[id]))).toBe(true);
  });
});

describe("signalsSection", () => {
  it("tells the ranker what she opened and what she swiped away", () => {
    const text = signalsSection({
      recentReads: ["FT | Chip exports"],
      recentSkips: ["Daily Mail | Royal gossip"],
      oftenSkippedSources: [{ name: "Daily Mail", skipped: 4, read: 0 }],
    });
    expect(text).toContain("Recently opened (more like these):\n- FT | Chip exports");
    expect(text).toContain("dismissed without opening");
    expect(text).toContain("- Daily Mail | Royal gossip");
    expect(text).toContain("Daily Mail(4 skipped/0 opened)");
  });

  it("adds nothing when there's no history", () => {
    expect(signalsSection(undefined)).toBe("");
    expect(signalsSection({ recentReads: [], recentSkips: [], oftenSkippedSources: [] })).toBe("");
  });
});
