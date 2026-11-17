import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const user = { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() };
vi.mock("@/lib/prisma", () => ({ prisma: { user } }));

const { encryptSecret, decryptSecret } = await import("./token-crypto");
const {
  getGmailAccessToken,
  saveGmailRefreshToken,
  primeGmailAccessToken,
  clearGmailTokenCacheForTests,
  connectGmailForUser,
} = await import("./gmail-token");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "s");
  clearGmailTokenCacheForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("getGmailAccessToken", () => {
  it("returns null without calling Google when Gmail was never connected", async () => {
    user.findUnique.mockResolvedValue({ gmailRefreshTokenEnc: null });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await getGmailAccessToken("u1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mints an access token from the stored refresh token, then serves it from cache", async () => {
    user.findUnique.mockResolvedValue({ gmailRefreshTokenEnc: encryptSecret("rt") });
    const fetchMock = vi.fn().mockResolvedValue(json({ access_token: "at", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getGmailAccessToken("u1")).toBe("at");
    expect(await getGmailAccessToken("u1")).toBe("at");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][1].body)).toContain("refresh_token=rt");
  });

  it("uses the token primed at sign-in without a refresh", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    primeGmailAccessToken("u1", "fresh", Date.now() + 3_600_000);
    expect(await getGmailAccessToken("u1")).toBe("fresh");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops a revoked/expired token and records why, so the UI can ask to reconnect", async () => {
    user.findUnique.mockResolvedValue({ gmailRefreshTokenEnc: encryptSecret("rt") });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "invalid_grant" }, 400)));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await getGmailAccessToken("u1")).toBeNull();
    expect(user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { gmailRefreshTokenEnc: null, gmailTokenError: "invalid_grant" },
    });
  });

  it("keeps the token on a transient Google error", async () => {
    user.findUnique.mockResolvedValue({ gmailRefreshTokenEnc: encryptSecret("rt") });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "backendError" }, 503)));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await getGmailAccessToken("u1")).toBeNull();
    expect(user.update).not.toHaveBeenCalled();
  });

  it("stores a rotated refresh token", async () => {
    user.findUnique.mockResolvedValue({ gmailRefreshTokenEnc: encryptSecret("old") });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ access_token: "at", refresh_token: "new" })));
    await getGmailAccessToken("u1");
    const saved = user.update.mock.calls[0][0].data.gmailRefreshTokenEnc as string;
    expect(decryptSecret(saved)).toBe("new");
  });
});

describe("saveGmailRefreshToken", () => {
  it("stores the token encrypted and clears any previous error", async () => {
    user.findUnique.mockResolvedValue(null);
    user.upsert.mockResolvedValue({ id: "u9" });
    expect(await saveGmailRefreshToken("a@b.c", "rt")).toBe("u9");
    const arg = user.upsert.mock.calls[0][0];
    expect(arg.update.gmailTokenError).toBeNull();
    expect(decryptSecret(arg.update.gmailRefreshTokenEnc)).toBe("rt");
  });

  it("doesn't replace a mailbox chosen with 'Use a different Gmail' when she signs in", async () => {
    user.findUnique.mockResolvedValue({ id: "u1", gmailConnectedSeparately: true, gmailRefreshTokenEnc: "x" });
    expect(await saveGmailRefreshToken("login@b.c", "login-rt")).toBe("u1");
    expect(user.upsert).not.toHaveBeenCalled();
  });
});

describe("connectGmailForUser", () => {
  it("stores the other mailbox's token on the signed-in user and restarts the sync window", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await connectGmailForUser("u1", "other-rt", "other-at", 3_600_000);
    const data = user.update.mock.calls[0][0].data;
    expect(decryptSecret(data.gmailRefreshTokenEnc)).toBe("other-rt");
    expect(data).toMatchObject({ gmailConnectedSeparately: true, newslettersSyncedAt: null, gmailTokenError: null });
    expect(await getGmailAccessToken("u1")).toBe("other-at");
  });
});
