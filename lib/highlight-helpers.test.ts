import { describe, expect, it } from "vitest";
import { anchorFor, highlightsToMarkdown, locateQuote } from "./highlight-helpers";

const text = "The cat sat. The dog ran far away. Later, the cat sat again on the mat.";

describe("locateQuote", () => {
  it("round-trips an anchor made from a selection", () => {
    const start = text.indexOf("dog ran");
    const anchor = anchorFor(text, start, start + "dog ran".length);
    expect(locateQuote(text, anchor)).toEqual({ start, end: start + 7 });
  });

  it("uses context to pick the right one of repeated quotes", () => {
    const second = text.lastIndexOf("cat sat");
    const anchor = anchorFor(text, second, second + 7);
    expect(locateQuote(text, anchor)?.start).toBe(second);
  });

  it("ignores whitespace differences between views", () => {
    const reflowed = "The cat sat.\n\n  The dog   ran far away.";
    const loc = locateQuote(reflowed, { quote: "The dog ran far", prefix: "sat. ", suffix: " away." });
    expect(loc).not.toBeNull();
    expect(reflowed.slice(loc!.start, loc!.end)).toBe("The dog   ran far");
  });

  it("returns null when the quote is gone", () => {
    expect(locateQuote(text, { quote: "elephant" })).toBeNull();
    expect(locateQuote(text, { quote: "   " })).toBeNull();
  });
});

describe("highlightsToMarkdown", () => {
  it("groups by article with links, quotes, and notes", () => {
    const md = highlightsToMarkdown(
      [
        { itemId: "a", itemTitle: "Old piece", publicationName: null, itemUrl: null, quote: "first", note: null, createdAt: "2026-11-01T00:00:00Z" },
        { itemId: "b", itemTitle: "AI capex", publicationName: "Stratechery", itemUrl: "https://stratechery.com/x", quote: "later  line", note: "Compare with Pragmatic", createdAt: "2026-11-10T02:00:00Z" },
        { itemId: "b", itemTitle: "AI capex", publicationName: "Stratechery", itemUrl: "https://stratechery.com/x", quote: "earlier line", note: null, createdAt: "2026-11-10T01:00:00Z" },
      ],
      "Highlights this week"
    );
    expect(md).toBe(
      [
        "# Highlights this week",
        "",
        "## [AI capex](https://stratechery.com/x)",
        "*Stratechery*",
        "",
        "> earlier line",
        "",
        "> later line",
        "",
        "**Note:** Compare with Pragmatic",
        "",
        "## Old piece",
        "",
        "> first",
        "",
      ].join("\n")
    );
  });
});
