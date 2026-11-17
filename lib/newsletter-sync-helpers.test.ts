import { describe, expect, it } from "vitest";
import {
  buildInboxQuery,
  buildSenderQuery,
  extractWebUrl,
  FIRST_SYNC_LOOKBACK_DAYS,
  INCREMENTAL_OVERLAP_MS,
  normalizeSenderEmail,
  syncWindowStart,
  isPlatformSender,
  QUERY_WIDENED_AT,
} from "./newsletter-sync-helpers";

describe("normalizeSenderEmail", () => {
  it("lowercases and keeps plus-addresses", () => {
    expect(normalizeSenderEmail("  Writer+DeepDives@Substack.com ")).toBe("writer+deepdives@substack.com");
  });
  it("strips mailto:", () => {
    expect(normalizeSenderEmail("mailto:hi@example.com")).toBe("hi@example.com");
  });
  it("rejects things that would break the Gmail query", () => {
    expect(normalizeSenderEmail("not an email")).toBeNull();
    expect(normalizeSenderEmail("a@b")).toBeNull();
    expect(normalizeSenderEmail("x@y.com) OR (in:anywhere")).toBeNull();
  });
});

describe("buildSenderQuery", () => {
  const after = new Date("2026-11-01T00:00:00Z");
  it("matches her senders and every newsletter platform anywhere in the mailbox", () => {
    const q = buildSenderQuery(["a@x.com", "b@y.com"], after);
    expect(q.startsWith("{from:a@x.com from:b@y.com from:substack.com ")).toBe(true);
    expect(q).toContain(`after:${after.getTime() / 1000} -in:chats -in:spam -in:trash -in:sent`);
    expect(q).not.toMatch(/in:inbox/);
  });
});

describe("buildInboxQuery", () => {
  it("searches the inbox plus newsletter platforms wherever they were filed", () => {
    const q = buildInboxQuery(new Date(0));
    expect(q).toMatch(/^\{in:inbox from:substack\.com from:stratechery\.com /);
    expect(q).toContain("} after:0 -in:chats -in:spam -in:trash -in:sent");
  });
});

describe("isPlatformSender", () => {
  it("recognizes platform domains and their subdomains only", () => {
    expect(isPlatformSender("derekthompson@substack.com")).toBe(true);
    expect(isPlatformSender("Email@Stratechery.com")).toBe(true);
    expect(isPlatformSender("thefrontiersyndicate@mail.beehiiv.com")).toBe(true);
    expect(isPlatformSender("team@info.classpass.com")).toBe(false);
    expect(isPlatformSender("someone@notsubstack.com")).toBe(false);
  });
});

describe("syncWindowStart", () => {
  const now = new Date("2026-11-20T00:00:00Z");
  it("reaches back the first-sync window when never synced", () => {
    expect(now.getTime() - syncWindowStart(null, now).getTime()).toBe(FIRST_SYNC_LOOKBACK_DAYS * 86_400_000);
  });
  it("overlaps the last sync so late mail is not missed", () => {
    const last = new Date("2026-11-19T00:00:00Z");
    expect(last.getTime() - syncWindowStart(last, now).getTime()).toBe(INCREMENTAL_OVERLAP_MS);
  });
  it("re-reads the full window once for mailboxes last synced with the old, narrower query", () => {
    const last = new Date(QUERY_WIDENED_AT.getTime() - 1);
    expect(now.getTime() - syncWindowStart(last, now).getTime()).toBe(FIRST_SYNC_LOOKBACK_DAYS * 86_400_000);
  });
});

describe("extractWebUrl", () => {
  it("prefers an explicit 'View in browser' link and strips tracking params", () => {
    const html = `
      <a href="https://example.substack.com/p/first-link?utm_source=x">Some post</a>
      <a href="https://example.substack.com/p/the-issue?utm_source=email&amp;token=abc&amp;keep=1">View in browser</a>`;
    expect(extractWebUrl(html)).toBe("https://example.substack.com/p/the-issue?keep=1");
  });
  it("falls back to the first post-looking URL", () => {
    const html = `<a href="https://twitter.com/x">tw</a><a href="https://stratechery.com/2026/some-update/">Read</a>`;
    expect(extractWebUrl(html)).toBe("https://stratechery.com/2026/some-update/");
  });
  it("skips tracking redirects and unsubscribe links", () => {
    const html = `
      <a href="https://substack.com/redirect/abc">View in browser</a>
      <a href="https://example.substack.com/action/disable_email">Unsubscribe</a>`;
    expect(extractWebUrl(html)).toBeNull();
  });
  it("returns null for empty input", () => {
    expect(extractWebUrl(undefined)).toBeNull();
    expect(extractWebUrl("")).toBeNull();
  });
});
