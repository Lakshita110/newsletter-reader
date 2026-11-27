import { afterEach, describe, expect, it, vi } from "vitest";

const getSessionUserId = vi.fn();
vi.mock("@/lib/session-user", () => ({ getSessionUserId: () => getSessionUserId() }));
const messageReadStat = {
  findUnique: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};
vi.mock("@/lib/prisma", () => ({ prisma: { messageReadStat } }));

const { POST } = await import("./route");

const post = (body: unknown) =>
  POST(new Request("https://app.test/api/read-state", { method: "POST", body: JSON.stringify(body) }));

afterEach(() => vi.clearAllMocks());

describe("POST /api/read-state", () => {
  it("records an open without un-finishing a finished item", async () => {
    getSessionUserId.mockResolvedValue("u1");
    messageReadStat.findUnique.mockResolvedValue({ id: "s1", completedAt: new Date(), completionPct: 100 });

    expect((await post({ messageId: "g1", state: "opened" })).status).toBe(200);

    const { update } = messageReadStat.upsert.mock.calls[0][0];
    expect(update).not.toHaveProperty("completedAt");
    expect(update).not.toHaveProperty("completionPct");
    expect(update.openCount).toEqual({ increment: 1 });
  });

  it("still lets Undo reset an item to in progress", async () => {
    getSessionUserId.mockResolvedValue("u1");
    messageReadStat.findUnique.mockResolvedValue({ id: "s1", completedAt: new Date(), completionPct: 100 });

    await post({ messageId: "g1", state: "in_progress" });

    expect(messageReadStat.upsert.mock.calls[0][0].update.completedAt).toBeNull();
  });

  it("rejects an unknown state instead of treating it as in progress", async () => {
    getSessionUserId.mockResolvedValue("u1");
    const res = await post({ messageId: "g1", state: "dne" });
    expect(res.status).toBe(400);
    expect(messageReadStat.upsert).not.toHaveBeenCalled();
  });
});
