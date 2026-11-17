import { afterEach, describe, expect, it, vi } from "vitest";
import { googleAuthUrl, redirectUri, statesMatch } from "./gmail-connect";

afterEach(() => vi.unstubAllEnvs());

describe("gmail-connect", () => {
  it("builds a consent + account-picker URL with the callback on the public app URL", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://reader.example/");
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    const url = new URL(googleAuthUrl("https://preview.vercel.app/api/gmail/connect", "st"));
    expect(url.searchParams.get("redirect_uri")).toBe("https://reader.example/api/gmail/callback");
    expect(url.searchParams.get("prompt")).toBe("consent select_account");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("gmail.readonly");
    expect(url.searchParams.get("state")).toBe("st");
  });

  it("falls back to the request origin without NEXTAUTH_URL", () => {
    vi.stubEnv("NEXTAUTH_URL", "");
    expect(redirectUri("http://localhost:3000/api/gmail/connect")).toBe("http://localhost:3000/api/gmail/callback");
  });

  it("only accepts the exact state it issued", () => {
    expect(statesMatch("abc", "abc")).toBe(true);
    expect(statesMatch("abc", "abd")).toBe(false);
    expect(statesMatch("abc", "ab")).toBe(false);
    expect(statesMatch(undefined, "abc")).toBe(false);
    expect(statesMatch("abc", null)).toBe(false);
  });
});
