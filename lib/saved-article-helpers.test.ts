import { describe, expect, it } from "vitest";
import { buildBookmarklet, canonicalizeUrl, countWords, hostLabel, isFetchableUrl } from "./saved-article-helpers";

describe("canonicalizeUrl", () => {
  it("strips tracking params and fragments but keeps real query params", () => {
    expect(canonicalizeUrl("https://www.wsj.com/tech/x?mod=hp&utm_source=tw&fbclid=1#comments")).toBe(
      "https://www.wsj.com/tech/x?mod=hp"
    );
  });
  it("rejects non-http(s) and garbage", () => {
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeUrl("not a url")).toBeNull();
  });
});

describe("isFetchableUrl", () => {
  it("allows public sites", () => {
    expect(isFetchableUrl("https://stratechery.com/2026/x/")).toBe(true);
  });
  it.each([
    "http://localhost:3000/api",
    "http://127.0.0.1/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://172.20.0.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "file:///etc/passwd",
  ])("blocks %s", (url) => {
    expect(isFetchableUrl(url)).toBe(false);
  });
});

describe("misc", () => {
  it("counts words and labels hosts", () => {
    expect(countWords("  one two\nthree ")).toBe(3);
    expect(hostLabel("https://www.ft.com/content/abc")).toBe("ft.com");
  });
  it("builds a bookmarklet that posts to the app with the token", () => {
    const b = decodeURIComponent(buildBookmarklet("https://feed.example.com", "tok123"));
    expect(b.startsWith("javascript:")).toBe(true);
    expect(b).toContain('"https://feed.example.com/api/save"');
    expect(b).toContain('"tok123"');
    expect(b).toContain("document.documentElement.outerHTML");
  });
});
