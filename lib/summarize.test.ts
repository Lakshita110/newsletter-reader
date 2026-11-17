import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  itemSummary: { findUnique: vi.fn(), upsert: vi.fn() },
  newsletterIssue: { findUnique: vi.fn() },
  savedArticle: { findFirst: vi.fn() },
  rssItem: { findUnique: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const chat = vi.fn();
vi.mock("@/lib/openrouter", () => ({
  openRouterChat: chat,
  FAST_MODEL_CHAIN: ["model-a", "model-b"],
  SMART_MODEL_CHAIN: ["smart-model", "model-a", "model-b"],
}));

const { getOrCreateSummary, buildSummaryPrompt, summaryModelChain, LONG_READ_WORDS } = await import("./summarize");

const longText = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENROUTER_API_KEY", "k");
  db.itemSummary.findUnique.mockResolvedValue(null);
  db.newsletterIssue.findUnique.mockResolvedValue({ subject: "AI capex", text: longText, html: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("summaryModelChain", () => {
  it("uses the strong model only for long reads", () => {
    expect(summaryModelChain(LONG_READ_WORDS - 1)[0]).toBe("model-a");
    expect(summaryModelChain(LONG_READ_WORDS)[0]).toBe("smart-model");
  });
});

describe("getOrCreateSummary", () => {
  it("sends a deep dive to the strong model first", async () => {
    const deepDive = Array.from({ length: LONG_READ_WORDS + 10 }, (_, i) => `w${i}`).join(" ");
    db.newsletterIssue.findUnique.mockResolvedValue({ subject: "Deep dive", text: deepDive, html: null });
    chat.mockResolvedValueOnce({ ok: true, content: "- a" });
    expect((await getOrCreateSummary("u", "g1")).model).toBe("smart-model");
  });

  it("returns the cached summary without calling the model", async () => {
    db.itemSummary.findUnique.mockResolvedValue({ summary: "- cached", model: "model-a" });
    expect(await getOrCreateSummary("u", "g1")).toEqual({ summary: "- cached", model: "model-a", cached: true });
    expect(chat).not.toHaveBeenCalled();
  });

  it("falls through the model chain and caches the first success", async () => {
    chat
      .mockResolvedValueOnce({ ok: false, status: 429, errorBody: "rate" })
      .mockResolvedValueOnce({ ok: true, content: " - point\n**Why it matters:** x " });
    const result = await getOrCreateSummary("u", "g1");
    expect(result).toEqual({ summary: "- point\n**Why it matters:** x", model: "model-b", cached: false });
    expect(db.itemSummary.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ itemId: "g1", model: "model-b" }) })
    );
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
