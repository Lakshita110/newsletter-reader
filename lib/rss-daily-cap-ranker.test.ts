import { describe, expect, it } from "vitest";
import { parseReasons, withMaxTokens } from "./rss-daily-cap-ranker";

// The ranker prompt asks the model to emit, per selected item, both an id
// (~10 tokens) and a short "<=8 words" reason (~20 tokens incl. JSON quoting).
// If max_tokens only covers the ids, the response is truncated mid-"reasons"
// (finish_reason="length") and reasons come back empty. These tests guard the
// budget against regressing to an ids-only size.
const TOKENS_PER_ITEM_IDS_AND_REASONS = 28;

describe("withMaxTokens", () => {
  it("leaves room for ids AND reasons at a realistic daily cap", () => {
    const cap = 35;
    // The historical bug used cap*12 (= 420), which only fit the ids.
    expect(withMaxTokens(cap)).toBeGreaterThan(cap * 12);
    expect(withMaxTokens(cap)).toBeGreaterThanOrEqual(cap * TOKENS_PER_ITEM_IDS_AND_REASONS);
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

describe("parseReasons", () => {
  it("reads reasons from a clean, well-formed envelope", () => {
    const content = '{"ids":["rss:a","rss:b"],"reasons":{"rss:a":"strong tech pick","rss:b":"fresh culture piece"}}';
    expect(parseReasons(content)).toEqual({
      "rss:a": "strong tech pick",
      "rss:b": "fresh culture piece",
    });
  });

  it("recovers complete reason pairs when the output is truncated mid-reasons", () => {
    // finish_reason="length" cuts the blob before the closing braces (and mid
    // way through the final value), so JSON.parse of the whole thing fails. The
    // earlier complete pairs must still survive — this is the exact regression
    // where ids worked but every reason came back empty.
    const truncated =
      '{"ids":["rss:a","rss:b","rss:c"],"reasons":{"rss:a":"strong tech pick","rss:b":"fresh culture piece","rss:c":"deeper read on cli';
    expect(parseReasons(truncated)).toEqual({
      "rss:a": "strong tech pick",
      "rss:b": "fresh culture piece",
    });
  });

  it("does not mistake bare ids in the ids array for reason entries", () => {
    const noReasons = '{"ids":["rss:a","rss:b","rss:c"]}';
    expect(parseReasons(noReasons)).toEqual({});
  });

  it("recovers reasons even when the model wraps output in a markdown fence", () => {
    const fenced = '```json\n{"ids":["rss:a"],"reasons":{"rss:a":"timely and relevant"}}\n```';
    expect(parseReasons(fenced)).toEqual({ "rss:a": "timely and relevant" });
  });

  it("returns an empty map for empty content", () => {
    expect(parseReasons("")).toEqual({});
  });
});
