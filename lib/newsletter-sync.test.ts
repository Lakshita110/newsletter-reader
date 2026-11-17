import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock both edges (Prisma and the Gmail client) so this exercises the real
// sync decisions: throttle, sender-list vs classifier mode, dedupe, and
// resume-after-time-budget.
const db = {
  user: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  newsletterSender: { findMany: vi.fn() },
  newsletterIssue: { findMany: vi.fn(), createMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const gmail = { users: { messages: { list: vi.fn(), get: vi.fn() } } };
vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
      },
    },
    gmail: () => gmail,
  },
}));

const { syncNewsletters } = await import("./newsletter-sync");

const b64 = (s: string) => Buffer.from(s).toString("base64url");

function message(id: string, from: string, { listHeader = true } = {}) {
  return {
    data: {
      id,
      threadId: `t-${id}`,
      internalDate: String(Date.parse("2026-11-10T08:00:00Z")),
      snippet: "hello",
      payload: {
        headers: [
          { name: "Subject", value: `Issue ${id}` },
          { name: "From", value: from },
          ...(listHeader ? [{ name: "List-Unsubscribe", value: "<mailto:u@x.com>" }] : []),
        ],
        mimeType: "text/html",
        body: { data: b64(`<p>Body ${id}</p><a href="https://pub.substack.com/p/issue-${id}">View in browser</a>`) },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUniqueOrThrow.mockResolvedValue({ newslettersSyncedAt: null });
  db.newsletterIssue.findMany.mockResolvedValue([]);
  db.newsletterIssue.createMany.mockImplementation(async ({ data }) => ({ count: data.length }));
  db.newsletterSender.findMany.mockResolvedValue([]);
});

describe("syncNewsletters", () => {
  it("does nothing without a token", async () => {
    expect(await syncNewsletters("u1", undefined)).toEqual({ status: "no-token", added: 0 });
    expect(gmail.users.messages.list).not.toHaveBeenCalled();
  });

  it("is throttled right after a sync unless forced", async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ newslettersSyncedAt: new Date() });
    expect((await syncNewsletters("u1", "tok")).status).toBe("skipped-recent");
    gmail.users.messages.list.mockResolvedValue({ data: { messages: [] } });
    expect((await syncNewsletters("u1", "tok", { force: true })).status).toBe("synced");
  });

  it("with a sender list: searches all mail for those senders and trusts them without the classifier", async () => {
    db.newsletterSender.findMany.mockResolvedValue([{ email: "pub@substack.com" }]);
    gmail.users.messages.list.mockResolvedValue({ data: { messages: [{ id: "m1" }, { id: "m2" }] } });
    gmail.users.messages.get.mockImplementation(async ({ id }) =>
      message(id, "Pub <pub@substack.com>", { listHeader: false })
    );
    db.newsletterIssue.findMany.mockResolvedValue([{ gmailMessageId: "m1" }]); // m1 already stored

    const result = await syncNewsletters("u1", "tok");

    const q = gmail.users.messages.list.mock.calls[0][0].q as string;
    expect(q).toContain("from:pub@substack.com");
    expect(q).not.toContain("in:inbox");
    expect(gmail.users.messages.get).toHaveBeenCalledTimes(1); // only m2 fetched
    const stored = db.newsletterIssue.createMany.mock.calls[0][0].data[0];
    expect(stored).toMatchObject({
      userId: "u1",
      gmailMessageId: "m2",
      fromEmail: "pub@substack.com",
      fromName: "Pub",
      webUrl: "https://pub.substack.com/p/issue-m2",
      text: null, // extracted from HTML lazily on first open
    });
    expect(result).toEqual({ status: "synced", added: 1 });
    expect(db.user.update).toHaveBeenCalled();
  });

  it("without a sender list: inbox plus platforms, and drops what the classifier rejects", async () => {
    gmail.users.messages.list.mockResolvedValue({ data: { messages: [{ id: "news" }, { id: "friend" }] } });
    gmail.users.messages.get.mockImplementation(async ({ id }) =>
      id === "news"
        ? message(id, "Daily <hello@news.com>")
        : message(id, "Friend <friend@gmail.com>", { listHeader: false })
    );
    const result = await syncNewsletters("u1", "tok");
    expect(gmail.users.messages.list.mock.calls[0][0].q).toContain("in:inbox");
    expect(
      db.newsletterIssue.createMany.mock.calls[0][0].data.map((r: { gmailMessageId: string }) => r.gmailMessageId)
    ).toEqual(["news"]);
    expect(result.added).toBe(1);
  });

  it("without a sender list: keeps platform issues (archived or labeled) even when the classifier wouldn't", async () => {
    gmail.users.messages.list.mockResolvedValue({ data: { messages: [{ id: "derek" }] } });
    // No List-Unsubscribe header: on its own the classifier would drop this.
    gmail.users.messages.get.mockImplementation(async ({ id }) =>
      message(id, "Derek Thompson <derekthompson@substack.com>", { listHeader: false })
    );
    const result = await syncNewsletters("u1", "tok");
    expect(gmail.users.messages.list.mock.calls[0][0].q).toContain("from:substack.com");
    expect(result.added).toBe(1);
  });

  it("stops at the time budget without advancing the sync cursor, so the next call resumes", async () => {
    db.newsletterSender.findMany.mockResolvedValue([{ email: "pub@substack.com" }]);
    const ids = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}` }));
    gmail.users.messages.list.mockResolvedValue({ data: { messages: ids } });
    gmail.users.messages.get.mockImplementation(async ({ id }) => {
      await new Promise((r) => setTimeout(r, 15));
      return message(id, "Pub <pub@substack.com>");
    });
    const result = await syncNewsletters("u1", "tok", { timeBudgetMs: 5 });
    expect(result.status).toBe("partial");
    expect(result.added).toBe(8); // one concurrent batch
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("reports Gmail auth failures instead of throwing", async () => {
    gmail.users.messages.list.mockRejectedValue({ response: { status: 401 } });
    expect((await syncNewsletters("u1", "tok")).status).toBe("auth-error");
  });
});
