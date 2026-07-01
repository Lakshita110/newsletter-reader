import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DigestUser } from "./send-daily-digest";
import { normalizeDigestEmail, resolveDigestRecipient } from "./send-daily-digest";

const findFirstMock = vi.fn();
const findManyMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userRssDailyRankSnapshot: { findFirst: (...args: unknown[]) => findFirstMock(...args) },
    rssItem: { findMany: (...args: unknown[]) => findManyMock(...args) },
    user: { update: (...args: unknown[]) => updateMock(...args) },
  },
}));

const { sendDigestForUser } = await import("./send-daily-digest");

function makeUser(overrides: Partial<DigestUser> = {}): DigestUser {
  return {
    id: "user-1",
    email: "reader@example.com",
    digestEmail: null,
    digestTimezone: "UTC",
    digestLastSentAt: null,
    ...overrides,
  };
}

function makeTransporter() {
  return { sendMail: vi.fn().mockResolvedValue(undefined) } as unknown as Parameters<
    typeof sendDigestForUser
  >[0]["transporter"];
}

beforeEach(() => {
  findFirstMock.mockReset();
  findManyMock.mockReset();
  updateMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sendDigestForUser", () => {
  it("skips a user already sent today, without touching the DB or sending mail", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-07-01T12:00:00Z"));
    const transporter = makeTransporter();
    const result = await sendDigestForUser({
      transporter,
      fromEmail: "cluck@example.com",
      user: makeUser({ digestLastSentAt: new Date("2026-07-01T07:05:00Z") }),
    });

    expect(result).toEqual({ status: "skipped", reason: "already_sent_today" });
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(transporter.sendMail).not.toHaveBeenCalled();
  });

  it("force bypasses the already-sent guard and sends again", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-07-01T12:00:00Z"));
    findFirstMock.mockResolvedValue({ rankedItemIds: ["rss:abc123"] });
    findManyMock.mockResolvedValue([
      { id: "abc123", title: "A test article", snippet: "snippet", link: "https://example.com/a", source: { name: "Test Source" } },
    ]);
    const transporter = makeTransporter();

    const result = await sendDigestForUser({
      transporter,
      fromEmail: "cluck@example.com",
      user: makeUser({ digestLastSentAt: new Date("2026-07-01T07:05:00Z") }),
      force: true,
    });

    expect(result).toEqual({ status: "sent", itemCount: 1, sentTo: "reader@example.com" });
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "reader@example.com" })
    );
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { digestLastSentAt: expect.any(Date) },
    });
  });

  it("sends to the configured digestEmail override instead of the account email", async () => {
    findFirstMock.mockResolvedValue({ rankedItemIds: ["rss:abc123"] });
    findManyMock.mockResolvedValue([
      { id: "abc123", title: "A test article", snippet: "s", link: "https://example.com/a", source: { name: "Test Source" } },
    ]);
    const transporter = makeTransporter();

    const result = await sendDigestForUser({
      transporter,
      fromEmail: "cluck@example.com",
      user: makeUser({ digestEmail: "elsewhere@example.com" }),
      force: true,
    });

    expect(result).toEqual({ status: "sent", itemCount: 1, sentTo: "elsewhere@example.com" });
    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "elsewhere@example.com" })
    );
  });

  it("skips when there's no rank snapshot for today, even when forced", async () => {
    findFirstMock.mockResolvedValue(null);
    const transporter = makeTransporter();

    const result = await sendDigestForUser({
      transporter,
      fromEmail: "cluck@example.com",
      user: makeUser(),
      force: true,
    });

    expect(result).toEqual({ status: "skipped", reason: "no_ranked_items" });
    expect(transporter.sendMail).not.toHaveBeenCalled();
  });

  it("skips when ranked ids no longer resolve to any rss items", async () => {
    findFirstMock.mockResolvedValue({ rankedItemIds: ["rss:deleted-item"] });
    findManyMock.mockResolvedValue([]);
    const transporter = makeTransporter();

    const result = await sendDigestForUser({
      transporter,
      fromEmail: "cluck@example.com",
      user: makeUser(),
      force: true,
    });

    expect(result).toEqual({ status: "skipped", reason: "no_ranked_items" });
    expect(transporter.sendMail).not.toHaveBeenCalled();
  });

  it("reports an error instead of throwing when sendMail rejects", async () => {
    findFirstMock.mockResolvedValue({ rankedItemIds: ["rss:abc123"] });
    findManyMock.mockResolvedValue([
      { id: "abc123", title: "A test article", snippet: "", link: null, source: { name: "Test Source" } },
    ]);
    const transporter = {
      sendMail: vi.fn().mockRejectedValue(new Error("SMTP rejected")),
    } as unknown as Parameters<typeof sendDigestForUser>[0]["transporter"];

    const result = await sendDigestForUser({
      transporter,
      fromEmail: "cluck@example.com",
      user: makeUser(),
      force: true,
    });

    expect(result).toEqual({ status: "error", message: "SMTP rejected" });
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("normalizeDigestEmail", () => {
  it("trims and keeps a valid address", () => {
    expect(normalizeDigestEmail("  me@example.com  ")).toBe("me@example.com");
  });

  it("returns null for blank, missing, or malformed input", () => {
    expect(normalizeDigestEmail("")).toBeNull();
    expect(normalizeDigestEmail("   ")).toBeNull();
    expect(normalizeDigestEmail(null)).toBeNull();
    expect(normalizeDigestEmail(undefined)).toBeNull();
    expect(normalizeDigestEmail("not-an-email")).toBeNull();
    expect(normalizeDigestEmail("a@b")).toBeNull();
  });
});

describe("resolveDigestRecipient", () => {
  it("prefers a valid override over the account email", () => {
    expect(resolveDigestRecipient({ email: "acct@example.com", digestEmail: "override@example.com" })).toBe(
      "override@example.com"
    );
  });

  it("falls back to the account email when the override is unset or invalid", () => {
    expect(resolveDigestRecipient({ email: "acct@example.com", digestEmail: null })).toBe("acct@example.com");
    expect(resolveDigestRecipient({ email: "acct@example.com", digestEmail: "garbage" })).toBe("acct@example.com");
  });
});
