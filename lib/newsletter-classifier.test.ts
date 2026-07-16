import { describe, expect, it } from "vitest";
import { classifyNewsletter, getHeader } from "./newsletter-classifier";

type Header = { name: string; value: string };

const headers = (...pairs: Array<[string, string]>): Header[] =>
  pairs.map(([name, value]) => ({ name, value }));

describe("getHeader", () => {
  it("matches header names case-insensitively", () => {
    const h = headers(["List-ID", "weekly.example.com"]);
    expect(getHeader(h, "list-id")).toBe("weekly.example.com");
  });

  it("returns empty string when absent or headers are undefined", () => {
    expect(getHeader(undefined, "Subject")).toBe("");
    expect(getHeader([], "Subject")).toBe("");
  });
});

describe("classifyNewsletter", () => {
  it("classifies anything with a strong list header as a newsletter", () => {
    const result = classifyNewsletter(
      headers(["List-Unsubscribe", "<mailto:unsub@example.com>"]),
      "Anything at all",
      "Someone <someone@example.com>",
      ""
    );
    expect(result.isNewsletter).toBe(true);
    expect(result.reasons).toContain("header:List-Unsubscribe");
  });

  it("classifies text-signal-only newsletters once enough weak signals stack", () => {
    const result = classifyNewsletter(
      undefined,
      "The Weekly Digest — Issue 42",
      "The Digest <newsletter@thedigest.co>",
      "Unsubscribe at any time. This week's top stories..."
    );
    // from:automation (+2) + newsletter-terms (+1) + footer-terms (+2) >= 3
    expect(result.isNewsletter).toBe(true);
  });

  it("rejects a personal reply from a personal mailbox", () => {
    const result = classifyNewsletter(
      undefined,
      "Re: dinner on friday",
      "Alex <alex@gmail.com>",
      "let me know if that works, thanks!"
    );
    expect(result.isNewsletter).toBe(false);
    expect(result.score).toBeLessThan(0);
  });

  it("rejects transactional mail like receipts and codes", () => {
    const result = classifyNewsletter(
      undefined,
      "Your verification code",
      "Acme <no-reply@acme.com>",
      "Your one-time code is 123456"
    );
    expect(result.isNewsletter).toBe(false);
  });

  it("a strong list header outweighs a personal-domain sender", () => {
    const result = classifyNewsletter(
      headers(["List-Id", "<hobby-letter.gmail.com>"]),
      "Hobby letter #3",
      "Hobbyist <hobbyist@gmail.com>",
      ""
    );
    expect(result.isNewsletter).toBe(true);
    expect(result.reasons).not.toContain("negative:personal-domain");
  });
});
