import { describe, expect, it } from "vitest";
import { discoverFeedCandidates, feedLinksFromHtml } from "./feed-discovery";

describe("feedLinksFromHtml", () => {
  it("finds RSS and Atom links advertised in the head, resolving relative hrefs", () => {
    const html = `<head>
      <link rel="stylesheet" href="/x.css">
      <link rel="alternate" type="application/rss+xml" title="RSS" href="/feed/">
      <link type="application/atom+xml" rel="alternate" href="https://cdn.example.com/atom.xml?a=1&amp;b=2">
      <link rel="alternate" hreflang="fr" href="/fr">
    </head>`;
    expect(feedLinksFromHtml(html, "https://example.com/post/1")).toEqual([
      "https://example.com/feed/",
      "https://cdn.example.com/atom.xml?a=1&b=2",
    ]);
  });
});

describe("discoverFeedCandidates", () => {
  it("puts advertised feeds before common paths", async () => {
    const candidates = await discoverFeedCandidates(
      "https://blog.example.com/some-post",
      async () => '<link rel="alternate" type="application/rss+xml" href="/rss/index.xml">'
    );
    expect(candidates[0]).toBe("https://blog.example.com/rss/index.xml");
    expect(candidates).toContain("https://blog.example.com/feed");
  });

  it("still guesses common paths when the page can't be fetched", async () => {
    const candidates = await discoverFeedCandidates("https://example.com", async () => null);
    expect(candidates[0]).toBe("https://example.com/feed");
  });
});
