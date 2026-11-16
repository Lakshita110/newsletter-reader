import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  itemSummary: { findUnique: vi.fn(), upsert: vi.fn() },
  newsletterIssue: { findUnique: vi.fn() },
  savedArticle: { findFirst: vi.fn() },
  rssItem: { findUnique: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const chat = vi.fn();
vi.mock("@/lib/openrouter", () => ({ openRouterChat: chat, RANKING_MODEL_CHAIN: ["model-a", "model-b"] }));

const { getOrCreateSummary, buildSummaryPrompt } = await import("./summarize");

const longText = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENROUTER_API_KEY", "k");
  db.itemSummary.findUnique.mockResolvedValue(null);
  db.newsletterIssue.findUnique.mockResolvedValue({ subject: "AI capex", text: longText, html: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("getOrCreateSummary", () => {
  it("returns the cached summary without calling the model", async () => {
    db.itemSummary.findUnique.mockResolvedValue({ summary: "- cached", model: "model-a" });
    expect(await getOrCreateSummary("u", "g1")).toEqual({ summary: "- cached", model: "model-a", cached: true });
    expect(chat).not.toHaveBeenCalled();
  });

  it("falls through the model chain and caches the first success", async () => {
    chat.mockResolvedValueOnce({ ok: false, status: 429, errorBody: "rate" }).mockResolvedValueOnce({ ok: true, content: " - point\n**Why it matters:** x " });
    const result = await getOrCreateSummary("u", "g1");
    expect(result).toEqual({ summary: "- point\n**Why it matters:** x", model: "model-b", cached: false });
    expect(db.itemSummary.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ itemId: "g1", model: "model-b" }) }));
  });

  it("refuses without an API key, for missing items, and for very short items", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    await expect(getOrCreateSummary("u", "g1")).rejects.toMatchObject({ status: 503 });
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    db.newsletterIssue.findUnique.mockResolvedValue(null);
    await expect(getOrCreateSummary("u", "g1")).rejects.toMatchObject({ status: 404 });
    db.newsletterIssue.findUnique.mockResolvedValue({ subject: "s", text: "too short", html: null });
    await expect(getOrCreateSummary("u", "g1")).rejects.toMatchObject({ status: 422 });
    expect(chat).not.toHaveBeenCalled();
  });
});

describe("buildSummaryPrompt", () => {
  it("caps the article text sent to the model", () => {
    const [, user] = buildSummaryPrompt("T", "x".repeat(50000));
    expect(user.content.length).toBeLessThan(14100);
  });
});
