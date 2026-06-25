import { describe, expect, it } from "vitest";
import { withMaxTokens } from "./rss-daily-cap-ranker";

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
