import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock both edges (Prisma and the Gmail client) so this exercises the real
// sync decisions: throttle, approved senders + platforms only, dedupe, and
// resume-after-time-budget.
const db = {
  gmailAccount: { findMany: vi.fn(), update: vi.fn() },
  newsletterSender: { findMany: vi.fn() },
  newsletterIssue: { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const getGmailAccessToken = vi.fn();
vi.mock("@/lib/gmail-token", () => ({ getGmailAccessToken: (id: string) => getGmailAccessToken(id) }));

const gmail = { users: { getProfile: vi.fn(), messages: { list: vi.fn(), get: vi.fn() } } };
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

const { getStoredNewsletterFeed, syncNewsletters, syncAllMailboxes } = await import("./newsletter-sync");

const mailbox = (overrides: Partial<{ id: string; email: string | null; syncedAt: Date | null }> = {}) => ({
  id: "g1",
  email: "me@gmail.com",
  syncedAt: null,
  ...overrides,
});

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
  db.newsletterIssue.findMany.mockResolvedValue([]);
  db.newsletterIssue.createMany.mockImplementation(async ({ data }) => ({ count: data.length }));
  db.newsletterSender.findMany.mockResolvedValue([]);
});

describe("syncNewsletters", () => {
  it("is throttled right after a sync unless forced", async () => {
    const recent = mailbox({ syncedAt: new Date() });
    expect((await syncNewsletters("u1", recent, "tok")).status).toBe("skipped-recent");
    gmail.users.messages.list.mockResolvedValue({ data: { messages: [] } });
    expect((await syncNewsletters("u1", recent, "tok", { force: true })).status).toBe("synced");
  });

  it("records the address of a carried-over mailbox that has none yet", async () => {
    gmail.users.getProfile.mockResolvedValue({ data: { emailAddress: "News@Gmail.com" } });
    gmail.users.messages.list.mockResolvedValue({ data: { messages: [] } });
    await syncNewsletters("u1", mailbox({ email: null }), "tok");
    expect(db.gmailAccount.update).toHaveBeenCalledWith({ where: { id: "g1" }, data: { email: "news@gmail.com" } });
  });

  it("with a sender list: searches all mail for those senders and trusts them without the classifier", async () => {
    db.newsletterSender.findMany.mockResolvedValue([{ email: "pub@substack.com" }]);
    gmail.users.messages.list.mockResolvedValue({ data: { messages: [{ id: "m1" }, { id: "m2" }] } });
    gmail.users.messages.get.mockImplementation(async ({ id }) =>
      message(id, "Pub <pub@substack.com>", { listHeader: false })
    );
    db.newsletterIssue.findMany.mockResolvedValue([{ gmailMessageId: "m1" }]); // m1 already stored

    const result = await syncNewsletters("u1", mailbox(), "tok");

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
    expect(db.gmailAccount.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "g1" } }));
  });

  it("without a sender list: only searches newsletter platforms, never guesses from the inbox", async () => {
    gmail.users.messages.list.mockResolvedValue({ data: { messages: [{ id: "derek" }] } });
    gmail.users.messages.get.mockImplementation(async ({ id }) =>
      message(id, "Derek Thompson <derekthompson@substack.com>", { listHeader: false })
    );
    const result = await syncNewsletters("u1", mailbox(), "tok");
    const q = gmail.users.messages.list.mock.calls[0][0].q as string;
    expect(q).toContain("from:substack.com");
    // Account notices and promos sit in the inbox with List-Unsubscribe
    // headers; searching the inbox is what let them in.
    expect(q).not.toContain("in:inbox");
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
    const result = await syncNewsletters("u1", mailbox(), "tok", { timeBudgetMs: 5 });
    expect(result.status).toBe("partial");
    expect(result.added).toBe(8); // one concurrent batch
    expect(db.gmailAccount.update).not.toHaveBeenCalled();
  });

  it("reports Gmail auth failures instead of throwing", async () => {
    gmail.users.messages.list.mockRejectedValue({ response: { status: 401 } });
    expect((await syncNewsletters("u1", mailbox(), "tok")).status).toBe("auth-error");
  });
});

describe("syncAllMailboxes", () => {
  it("syncs each mailbox on its own, skipping disconnected ones and surviving a failure", async () => {
    db.gmailAccount.findMany.mockResolvedValue([
      mailbox({ id: "a", email: "a@gmail.com" }),
      mailbox({ id: "b", email: "b@gmail.com" }),
      mailbox({ id: "c", email: "c@gmail.com" }),
    ]);
    getGmailAccessToken.mockImplementation(async (id: string) => (id === "b" ? null : `tok-${id}`));
    gmail.users.messages.list
      .mockRejectedValueOnce(new Error("boom")) // mailbox a
      .mockResolvedValueOnce({ data: { messages: [] } }); // mailbox c
    const results = await syncAllMailboxes("u1");
    expect(results.map((r) => [r.accountId, r.status])).toEqual([
      ["a", "error"],
      ["b", "no-token"],
      ["c", "synced"],
    ]);
  });
});

describe("getStoredNewsletterFeed", () => {
  it("only shows approved senders and newsletter platforms, with decoded snippets and no lead photo", async () => {
    db.newsletterSender.findMany.mockResolvedValue([{ email: "today@economist.com" }]);
    db.newsletterIssue.findMany.mockResolvedValue([
      {
        gmailMessageId: "e1",
        fromEmail: "today@economist.com",
        fromName: "The Economist Today",
        publicationKey: "economist",
        subject: "The words to watch",
        snippet: "Trump&#39;s love of conquest",
        receivedAt: new Date("2026-11-20T08:00:00Z"),
        webUrl: null,
      },
    ]);

    const feed = await getStoredNewsletterFeed("u1");

    const where = db.newsletterIssue.findMany.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ fromEmail: { in: ["today@economist.com"] } });
    expect(where.OR).toContainEqual({ fromEmail: { endsWith: "@substack.com" } });
    expect(where.OR).toContainEqual({ fromEmail: { endsWith: ".substack.com" } });
    expect(feed[0].snippet).toBe("Trump's love of conquest");
    expect(feed[0].imageUrl).toBeUndefined();
  });
});
