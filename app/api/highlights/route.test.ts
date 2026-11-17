import { afterEach, describe, expect, it, vi } from "vitest";

const getSessionUserId = vi.fn();
vi.mock("@/lib/session-user", () => ({ getSessionUserId: () => getSessionUserId() }));
const highlight = { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() };
vi.mock("@/lib/prisma", () => ({ prisma: { highlight } }));

const { GET, POST } = await import("./route");

afterEach(() => vi.clearAllMocks());

describe("/api/highlights", () => {
  it("requires sign-in", async () => {
    getSessionUserId.mockResolvedValue(null);
    expect((await GET(new Request("https://app.test/api/highlights"))).status).toBe(401);
    expect((await POST(new Request("https://app.test/api/highlights", { method: "POST" }))).status).toBe(401);
  });

  it("only ever reads the signed-in user's highlights", async () => {
    getSessionUserId.mockResolvedValue("u1");
    await GET(new Request("https://app.test/api/highlights?itemId=rss:1&since=not-a-date"));
    expect(highlight.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1", itemId: "rss:1" }, orderBy: { createdAt: "asc" } })
    );
  });

  it("creates a highlight owned by the session user, ignoring any userId in the body", async () => {
    getSessionUserId.mockResolvedValue("u1");
    highlight.create.mockResolvedValue({ id: "h1" });
    const res = await POST(
      new Request("https://app.test/api/highlights", {
        method: "POST",
        body: JSON.stringify({ itemId: "rss:1", quote: "  a line  ", userId: "someone-else" }),
      })
    );
    expect(res.status).toBe(201);
    const data = highlight.create.mock.calls[0][0].data;
    expect(data.userId).toBe("u1");
    expect(data.itemTitle).toBe("(Untitled)");
  });

  it("rejects a highlight without a quote", async () => {
    getSessionUserId.mockResolvedValue("u1");
    const res = await POST(
      new Request("https://app.test/api/highlights", { method: "POST", body: JSON.stringify({ itemId: "rss:1" }) })
    );
    expect(res.status).toBe(400);
  });
});
