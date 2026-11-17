import { describe, expect, it } from "vitest";
import { resolveFeedUrl } from "./feed-url";

describe("resolveFeedUrl", () => {
  it("expands a bare Substack handle", () => {
    expect(resolveFeedUrl("lenny")).toBe("https://lenny.substack.com/feed");
  });

  it("maps any substack.com page to the publication feed", () => {
    expect(resolveFeedUrl("pragmaticengineer.substack.com")).toBe("https://pragmaticengineer.substack.com/feed");
    expect(resolveFeedUrl("https://astralcodexten.substack.com/p/some-post?utm_source=x")).toBe(
      "https://astralcodexten.substack.com/feed"
    );
  });

  it("handles open.substack.com share links", () => {
    expect(resolveFeedUrl("https://open.substack.com/pub/thecodercafe/p/post-slug")).toBe(
      "https://thecodercafe.substack.com/feed"
    );
  });

  it("treats a /p/ post link on a custom domain as Substack", () => {
    expect(resolveFeedUrl("https://www.lennysnewsletter.com/p/how-to-grow")).toBe(
      "https://www.lennysnewsletter.com/feed"
    );
  });

  it("leaves ordinary feed URLs alone", () => {
    expect(resolveFeedUrl("https://feeds.ft.com/rss/home")).toBe("https://feeds.ft.com/rss/home");
  });
});
