import { afterEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn().mockResolvedValue({ id: "u1" });
const findUnique = vi.fn();
const findFirst = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { user: { upsert, findUnique, findFirst } } }));
const saveLoginGmailToken = vi.fn().mockResolvedValue("u1");
vi.mock("@/lib/gmail-token", () => ({ saveLoginGmailToken }));

const { authOptions, isAllowedToSignIn } = await import("./auth");
type JwtArgs = Parameters<NonNullable<NonNullable<typeof authOptions.callbacks>["jwt"]>>[0];
const jwt = (args: Partial<JwtArgs>) => authOptions.callbacks!.jwt!(args as JwtArgs);

afterEach(() => vi.clearAllMocks());

describe("auth options", () => {
  it("doesn't force Google's consent screen on every sign-in, and keeps sessions for a year", () => {
    const provider = authOptions.providers[0] as unknown as {
      options: { authorization: { params: Record<string, string> } };
    };
    expect(provider.options.authorization.params.prompt).toBeUndefined();
    expect(provider.options.authorization.params.access_type).toBe("offline");
    expect(authOptions.session?.maxAge).toBe(365 * 24 * 60 * 60);
  });
});

describe("jwt callback", () => {
  it("stores a refresh token server-side and keeps Google tokens out of the cookie", async () => {
    const token = await jwt({
      token: { email: "a@b.c", sub: "g1" },
      account: {
        provider: "google",
        type: "oauth",
        providerAccountId: "g1",
        refresh_token: "rt",
        access_token: "at",
        expires_at: 2_000_000_000,
      },
    });
    expect(saveLoginGmailToken).toHaveBeenCalledWith("a@b.c", "rt");
    expect(token).not.toHaveProperty("refreshToken");
    expect(token).not.toHaveProperty("accessToken");
  });

  it("signs in without a refresh token (no consent screen) and leaves the stored one alone", async () => {
    await jwt({
      token: { email: "a@b.c" },
      account: { provider: "google", type: "oauth", providerAccountId: "g1", access_token: "at" },
    });
    expect(saveLoginGmailToken).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalled();
  });

  it("migrates a pre-change cookie's refresh token to the DB and slims the cookie", async () => {
    const token = await jwt({
      token: { email: "a@b.c", refreshToken: "legacy", accessToken: "x", accessTokenExpires: 1, error: "e" },
    });
    expect(saveLoginGmailToken).toHaveBeenCalledWith("a@b.c", "legacy");
    expect(token).toEqual({ email: "a@b.c" });
  });

  it("is a no-op on ordinary requests", async () => {
    const token = await jwt({ token: { email: "a@b.c", sub: "g1" } });
    expect(token).toEqual({ email: "a@b.c", sub: "g1" });
    expect(saveLoginGmailToken).not.toHaveBeenCalled();
  });
});

describe("single-user sign-in", () => {
  it("lets the owner back in", async () => {
    findUnique.mockResolvedValue({ id: "u1" });
    expect(await isAllowedToSignIn("owner@example.com")).toBe(true);
  });

  it("lets the very first account claim the app", async () => {
    findUnique.mockResolvedValue(null);
    findFirst.mockResolvedValue(null);
    expect(await isAllowedToSignIn("first@example.com")).toBe(true);
  });

  it("blocks any new account once someone owns it", async () => {
    findUnique.mockResolvedValue(null);
    findFirst.mockResolvedValue({ id: "u1" });
    expect(await isAllowedToSignIn("stranger@example.com")).toBe(false);
    expect(await isAllowedToSignIn(null)).toBe(false);
  });
});
