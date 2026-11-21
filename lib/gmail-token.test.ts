import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const user = { upsert: vi.fn() };
const gmailAccount = {
  findUnique: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
};
vi.mock("@/lib/prisma", () => ({ prisma: { user, gmailAccount } }));

const { encryptSecret, decryptSecret } = await import("./token-crypto");
const {
  getGmailAccessToken,
  saveLoginGmailToken,
  connectGmailAccount,
  removeGmailAccount,
  listGmailAccounts,
  clearGmailTokenCacheForTests,
} = await import("./gmail-token");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "s");
  clearGmailTokenCacheForTests();
  user.upsert.mockResolvedValue({ id: "u1" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("getGmailAccessToken", () => {
  it("returns null without calling Google when the mailbox has no token", async () => {
    gmailAccount.findUnique.mockResolvedValue({ refreshTokenEnc: null });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await getGmailAccessToken("g1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes once and then serves the cached token", async () => {
    gmailAccount.findUnique.mockResolvedValue({ refreshTokenEnc: encryptSecret("rt") });
    const fetchMock = vi.fn().mockResolvedValue(json({ access_token: "at", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getGmailAccessToken("g1")).toBe("at");
    expect(await getGmailAccessToken("g1")).toBe("at");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("marks only that mailbox disconnected on invalid_grant", async () => {
    gmailAccount.findUnique.mockResolvedValue({ refreshTokenEnc: encryptSecret("rt") });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "invalid_grant" }, 400)));
    expect(await getGmailAccessToken("g1")).toBeNull();
    expect(gmailAccount.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { refreshTokenEnc: null, tokenError: "invalid_grant" },
    });
  });

  it("keeps the token on a transient failure", async () => {
    gmailAccount.findUnique.mockResolvedValue({ refreshTokenEnc: encryptSecret("rt") });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "backend_error" }, 503)));
    expect(await getGmailAccessToken("g1")).toBeNull();
    expect(gmailAccount.update).not.toHaveBeenCalled();
  });

  it("stores a rotated refresh token", async () => {
    gmailAccount.findUnique.mockResolvedValue({ refreshTokenEnc: encryptSecret("old") });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ access_token: "at", refresh_token: "new" })));
    await getGmailAccessToken("g1");
    expect(decryptSecret(gmailAccount.update.mock.calls[0][0].data.refreshTokenEnc)).toBe("new");
  });
});

describe("saveLoginGmailToken", () => {
  it("connects the sign-in mailbox when she has none yet", async () => {
    gmailAccount.findMany.mockResolvedValue([]);
    expect(await saveLoginGmailToken("a@b.c", "rt")).toBe("u1");
    const arg = gmailAccount.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ userId_email: { userId: "u1", email: "a@b.c" } });
    expect(decryptSecret(arg.create.refreshTokenEnc)).toBe("rt");
  });

  it("refreshes the sign-in mailbox when it is already connected", async () => {
    gmailAccount.findMany.mockResolvedValue([{ email: "other@b.c" }, { email: "a@b.c" }]);
    await saveLoginGmailToken("a@b.c", "rt");
    expect(gmailAccount.upsert).toHaveBeenCalled();
  });

  it("doesn't re-add the sign-in mailbox after she removed it", async () => {
    gmailAccount.findMany.mockResolvedValue([{ email: "other@b.c" }]);
    await saveLoginGmailToken("a@b.c", "rt");
    expect(gmailAccount.upsert).not.toHaveBeenCalled();
  });
});

describe("connectGmailAccount", () => {
  it("adds the mailbox, rewinds its sync, and primes the token cache", async () => {
    gmailAccount.upsert.mockResolvedValue({ id: "g2" });
    vi.stubGlobal("fetch", vi.fn());
    await connectGmailAccount("u1", "news@b.c", "rt2", "at2", 3_600_000);
    const arg = gmailAccount.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ userId_email: { userId: "u1", email: "news@b.c" } });
    expect(arg.update).toMatchObject({ syncedAt: null, tokenError: null });
    expect(await getGmailAccessToken("g2")).toBe("at2");
  });
});

describe("listGmailAccounts / removeGmailAccount", () => {
  it("reports each mailbox's connection without exposing tokens", async () => {
    gmailAccount.findMany.mockResolvedValue([
      { id: "g1", email: "a@b.c", refreshTokenEnc: "x", tokenError: null },
      { id: "g2", email: "n@b.c", refreshTokenEnc: null, tokenError: "invalid_grant" },
    ]);
    expect(await listGmailAccounts("u1")).toEqual([
      { id: "g1", email: "a@b.c", connected: true, error: null },
      { id: "g2", email: "n@b.c", connected: false, error: "invalid_grant" },
    ]);
  });

  it("only removes the signed-in user's own mailbox", async () => {
    gmailAccount.deleteMany.mockResolvedValue({ count: 0 });
    expect(await removeGmailAccount("u1", "someone-elses")).toBe(false);
    expect(gmailAccount.deleteMany).toHaveBeenCalledWith({ where: { id: "someone-elses", userId: "u1" } });
  });
});
