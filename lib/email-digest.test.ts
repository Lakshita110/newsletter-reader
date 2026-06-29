import { describe, expect, it } from "vitest";
import {
  buildEmailHtml,
  getDigestSubject,
  getLocalDateKey,
  type DigestItem,
} from "./email-digest";

const sampleItems: DigestItem[] = [
  {
    title: "How Postgres indexes actually work",
    sourceName: "Planet Scale Blog",
    snippet: "A deep dive into B-tree internals and when a sequential scan is faster.",
    externalUrl: "https://example.com/pg-indexes",
  },
  {
    title: "The case for boring technology",
    sourceName: "Dan's Newsletter",
    snippet: "",
    externalUrl: null,
  },
];

describe("getDigestSubject", () => {
  it("pluralizes for multiple articles", () => {
    expect(getDigestSubject(5)).toBe("Your daily reading list — 5 articles");
  });

  it("uses the singular for exactly one article", () => {
    expect(getDigestSubject(1)).toBe("Your daily reading list — 1 article");
  });

  it("uses the plural for zero articles", () => {
    expect(getDigestSubject(0)).toBe("Your daily reading list — 0 articles");
  });
});

describe("getLocalDateKey", () => {
  // 2026-06-25T23:30:00Z -> already next day in Tokyo, still the 25th in NY.
  const lateUtc = new Date("2026-06-25T23:30:00Z");

  it("formats YYYY-MM-DD in the given timezone", () => {
    expect(getLocalDateKey("America/New_York", lateUtc)).toBe("2026-06-25");
  });

  it("rolls to the next local day across the date line", () => {
    expect(getLocalDateKey("Asia/Tokyo", lateUtc)).toBe("2026-06-26");
  });

  it("falls back to the UTC day key for an invalid timezone", () => {
    expect(getLocalDateKey("Not/AZone", lateUtc)).toBe("2026-06-25");
  });
});

describe("buildEmailHtml", () => {
  const html = buildEmailHtml(sampleItems, new Date("2026-06-25T12:00:00Z"));

  it("renders every item's title and source", () => {
    for (const item of sampleItems) {
      expect(html).toContain(item.title);
      expect(html).toContain(item.sourceName);
    }
  });

  it("links items that have an external url", () => {
    expect(html).toContain('href="https://example.com/pg-indexes"');
  });

  it("does not render a link for items without an external url", () => {
    // The second item has no url, so its title must appear as plain text,
    // never wrapped in an anchor pointing at a stringified null.
    expect(html).not.toContain('href="null"');
    expect(html).not.toContain(">null<");
  });

  it("omits the snippet block when the snippet is empty", () => {
    // Only the first item has a snippet, so exactly one snippet div renders.
    const snippetDivs = html.match(/font-size:13px;color:#374151/g) ?? [];
    expect(snippetDivs).toHaveLength(1);
  });

  it("truncates long snippets to 160 chars plus an ellipsis", () => {
    const longSnippet = "x".repeat(500);
    const out = buildEmailHtml(
      [{ title: "t", sourceName: "s", snippet: longSnippet, externalUrl: null }],
      new Date(),
    );
    expect(out).toContain(`${"x".repeat(160)}…`);
    expect(out).not.toContain("x".repeat(161));
  });

  it("formats the header date in the provided instant", () => {
    expect(html).toContain("Thursday, June 25");
  });

  it("produces a complete HTML document", () => {
    expect(html.trimStart().startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("</html>");
  });
});
