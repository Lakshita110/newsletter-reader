import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRssArticleDedupKey, dedupeByArticleKey, getRssDailyTargetCap } from "./rss-helpers";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getRssDailyTargetCap", () => {
  it("returns 0 for an empty candidate pool", () => {
    expect(getRssDailyTargetCap(0)).toBe(0);
    expect(getRssDailyTargetCap(-5)).toBe(0);
    expect(getRssDailyTargetCap(NaN)).toBe(0);
  });

  it("uses the 35 default and never exceeds the pool size", () => {
    expect(getRssDailyTargetCap(100)).toBe(35);
    expect(getRssDailyTargetCap(12)).toBe(12);
  });

  it("clamps the per-user preferred cap to the min/max window", () => {
    expect(getRssDailyTargetCap(100, 50)).toBe(40); // above max 40
    expect(getRssDailyTargetCap(100, 5)).toBe(30); // below min 30
    expect(getRssDailyTargetCap(100, 33)).toBe(33);
  });

  it("falls back to the same defaults when env values are not numeric", () => {
    // Regression: these branches used to fall back to 10/15 instead of 30/40.
    vi.stubEnv("RSS_DAILY_TARGET_MIN", "not-a-number");
    vi.stubEnv("RSS_DAILY_TARGET_MAX", "also-not");
    vi.stubEnv("RSS_DAILY_TARGET_DEFAULT", "nope");
    expect(getRssDailyTargetCap(100)).toBe(35);
    expect(getRssDailyTargetCap(100, 50)).toBe(40);
  });

  it("honors numeric env overrides", () => {
    vi.stubEnv("RSS_DAILY_TARGET_MIN", "5");
    vi.stubEnv("RSS_DAILY_TARGET_MAX", "10");
    vi.stubEnv("RSS_DAILY_TARGET_DEFAULT", "8");
    expect(getRssDailyTargetCap(100)).toBe(8);
    expect(getRssDailyTargetCap(100, 50)).toBe(10);
  });
});

describe("dedupeByArticleKey", () => {
  const item = (dedupKey: string, timeMs: number, tag: string) => ({ dedupKey, timeMs, tag });

  it("keeps the newer item for a duplicated key", () => {
    const result = dedupeByArticleKey(
      [item("k", 100, "old"), item("k", 200, "new"), item("other", 50, "solo")],
      (row) => row.timeMs
    );
    expect(result.map((row) => row.tag).sort()).toEqual(["new", "solo"]);
  });

  it("keeps the first item on an exact time tie", () => {
    const result = dedupeByArticleKey([item("k", 100, "first"), item("k", 100, "second")], (row) => row.timeMs);
    expect(result.map((row) => row.tag)).toEqual(["first"]);
  });
});

describe("buildRssArticleDedupKey", () => {
  it("canonicalizes URLs by stripping tracking params and trailing slashes", () => {
    const a = buildRssArticleDedupKey({ externalUrl: "https://example.com/post/?utm_source=x&utm_medium=y" });
    const b = buildRssArticleDedupKey({ externalUrl: "https://EXAMPLE.com/post" });
    expect(a).toBe(b);
    expect(a.startsWith("url:")).toBe(true);
  });

  it("falls back to normalized title+snippet text when there is no URL", () => {
    const a = buildRssArticleDedupKey({ title: "Hello, World!", snippet: "Some Text" });
    const b = buildRssArticleDedupKey({ title: "hello world", snippet: "some   text" });
    expect(a).toBe(b);
    expect(a.startsWith("text:")).toBe(true);
  });
});
