import { describe, expect, it } from "vitest";
import { readMinutes, WORDS_PER_MINUTE } from "./read-time";

describe("readMinutes", () => {
  it("rounds to whole minutes at the reading speed", () => {
    expect(readMinutes(WORDS_PER_MINUTE * 8)).toBe(8);
    expect(readMinutes(WORDS_PER_MINUTE * 8 + 100)).toBe(8);
    expect(readMinutes(WORDS_PER_MINUTE * 8 + 130)).toBe(9);
  });

  it("never says 0 min for something long enough to badge", () => {
    expect(readMinutes(120)).toBe(1);
  });

  it("skips teasers and bad input", () => {
    expect(readMinutes(40)).toBeUndefined();
    expect(readMinutes(0)).toBeUndefined();
    expect(readMinutes(Number.NaN)).toBeUndefined();
  });
});
