import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const { isLongformSource, LONGFORM_MAX_POSTS } = await import("./longform");

describe("isLongformSource", () => {
  it("treats slow feeds as newsletters and busy ones as news", () => {
    expect(isLongformSource({ category: "other", rssUrl: "https://www.netinterest.co/feed", recentPosts: 2 })).toBe(
      true
    );
    expect(isLongformSource({ category: "other", rssUrl: "https://rss.nytimes.com/x.xml", recentPosts: 400 })).toBe(
      false
    );
    expect(
      isLongformSource({ category: "other", rssUrl: "https://a.com/feed", recentPosts: LONGFORM_MAX_POSTS + 1 })
    ).toBe(false);
  });

  it("respects a news category and doesn't mistake a quiet news site for a newsletter", () => {
    expect(isLongformSource({ category: "news", rssUrl: "https://feeds.propublica.org/x", recentPosts: 3 })).toBe(
      false
    );
    expect(isLongformSource({ category: "other", rssUrl: "https://feeds.propublica.org/x", recentPosts: 12 })).toBe(
      false
    );
  });

  it("always counts Substack feeds and the explicit newsletter category", () => {
    expect(isLongformSource({ category: "other", rssUrl: "https://lenny.substack.com/feed", recentPosts: 90 })).toBe(
      true
    );
    expect(isLongformSource({ category: "newsletter", rssUrl: "https://busy.example/feed", recentPosts: 90 })).toBe(
      true
    );
  });
});
