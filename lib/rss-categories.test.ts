import { describe, expect, it } from "vitest";
import { normalizeRssCategory, parseRssCategoryInput, RSS_CATEGORY_OPTIONS } from "./rss-categories";

describe("normalizeRssCategory", () => {
  it("accepts every option in the canonical list", () => {
    for (const option of RSS_CATEGORY_OPTIONS) {
      expect(normalizeRssCategory(option)).toBe(option);
    }
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(normalizeRssCategory("  Tech  ")).toBe("tech");
    expect(normalizeRssCategory("SCIENCE")).toBe("science");
  });

  it("rejects values outside the canonical list", () => {
    // Categories an LLM might plausibly emit that aren't in our enum — these
    // must not silently pass through as-is.
    expect(normalizeRssCategory("technology")).toBeNull();
    expect(normalizeRssCategory("sports")).toBeNull();
    expect(normalizeRssCategory("")).toBeNull();
  });
});

describe("parseRssCategoryInput", () => {
  it("flags a non-enum string as invalid rather than silently passing it through", () => {
    // This is the exact failure mode behind "invalid category option": a
    // caller (e.g. an AI feed suggestion) sends a category outside the enum
    // and the add-feed endpoint must reject it, not save garbage.
    const result = parseRssCategoryInput("technology");
    expect(result).toEqual({ isProvided: true, isInvalid: true, value: null });
  });

  it("accepts a valid category regardless of case/whitespace", () => {
    expect(parseRssCategoryInput(" Tech ")).toEqual({ isProvided: true, isInvalid: false, value: "tech" });
  });

  it("treats a missing field as not provided (not invalid)", () => {
    expect(parseRssCategoryInput(undefined)).toEqual({ isProvided: false, isInvalid: false, value: null });
  });

  it("treats an empty string as provided-but-blank, not invalid", () => {
    expect(parseRssCategoryInput("")).toEqual({ isProvided: true, isInvalid: false, value: null });
  });
});
