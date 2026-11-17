import { afterEach, describe, expect, it, vi } from "vitest";

// The save endpoint is reached from three very different clients (the app,
// the iOS Shortcut with a bearer token, and the bookmarklet's form post), so
// these tests pin down how each one is authenticated and answered.
const getSessionUserId = vi.fn();
vi.mock("@/lib/session-user", () => ({ getSessionUserId: () => getSessionUserId() }));

const findUserIdBySaveToken = vi.fn();
const saveArticle = vi.fn();
vi.mock("@/lib/saved-articles", () => {
  class SaveError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message);
    }
  }
  return {
    findUserIdBySaveToken: (t: unknown) => findUserIdBySaveToken(t),
    saveArticle: (a: unknown) => saveArticle(a),
    SaveError,
  };
});

const { POST, OPTIONS } = await import("./route");
const { SaveError } = await import("@/lib/saved-articles");

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  POST(new Request("https://app.test/api/save", { method: "POST", body, headers }));

afterEach(() => vi.clearAllMocks());

describe("POST /api/save", () => {
  it("answers CORS preflight so the bookmarklet works on any site", async () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("saves for the Shortcut with a bearer token and a bare URL body", async () => {
    findUserIdBySaveToken.mockResolvedValue("u1");
    saveArticle.mockResolvedValue({ id: "web:1", title: "T", wordCount: 900 });
    const res = await post("https://example.com/a", { Authorization: "Bearer tok" });
    expect(res.status).toBe(200);
    expect(findUserIdBySaveToken).toHaveBeenCalledWith("tok");
    expect(saveArticle).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", url: "https://example.com/a", via: "shortcut" })
    );
  });

  it("falls back to the signed-in session for the app", async () => {
    findUserIdBySaveToken.mockResolvedValue(null);
    getSessionUserId.mockResolvedValue("u2");
    saveArticle.mockResolvedValue({ id: "web:2", title: "T", wordCount: 0 });
    await post(JSON.stringify({ url: "https://example.com/b", title: "Given" }), {
      "Content-Type": "application/json",
    });
    expect(saveArticle).toHaveBeenCalledWith(expect.objectContaining({ userId: "u2", title: "Given", via: "app" }));
  });

  it("rejects requests with neither a valid token nor a session", async () => {
    findUserIdBySaveToken.mockResolvedValue(null);
    getSessionUserId.mockResolvedValue(null);
    const res = await post(JSON.stringify({ url: "https://example.com" }));
    expect(res.status).toBe(401);
    expect(saveArticle).not.toHaveBeenCalled();
  });

  it("answers the bookmarklet's form post with a small HTML page, including on failure", async () => {
    findUserIdBySaveToken.mockResolvedValue("u1");
    saveArticle.mockRejectedValue(new SaveError("That address isn't allowed", 400));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(new URLSearchParams({ url: "http://169.254.169.254/", token: "tok" }).toString(), {
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(await res.text()).toContain("That address isn't allowed");
  });

  it("requires a URL", async () => {
    findUserIdBySaveToken.mockResolvedValue("u1");
    const res = await post(JSON.stringify({ title: "no url" }));
    expect(res.status).toBe(400);
  });
});
