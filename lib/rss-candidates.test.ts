import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  userRssSubscription: { findMany: vi.fn() },
  newsletterIssue: { findMany: vi.fn() },
  messageReadStat: { findMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const { buildRankingCandidates } = await import("./rss-candidates");

const now = new Date("2026-11-17T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

function rssItem(id: string, link: string, publishedAt: Date) {
  return {
    id,
    title: `Story ${id}`,
    author: null,
    link,
    imageUrl: null,
    htmlRaw: null,
    snippet: "teaser",
    publishedAt,
    createdAt: publishedAt,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.messageReadStat.findMany.mockResolvedValue([]);
});

describe("buildRankingCandidates", () => {
  it("keeps the email copy when a Substack post also arrives through its RSS feed", async () => {
    db.userRssSubscription.findMany.mockResolvedValue([
      {
        category: "tech",
        source: {
          id: "src1",
          name: "Lenny's Newsletter",
          items: [
            // Same post as the email below; the feed copy is newer but truncated for paid posts.
            rssItem("dup", "https://www.lennysnewsletter.com/p/how-to-grow?utm_source=rss", hoursAgo(1)),
            rssItem("other", "https://www.lennysnewsletter.com/p/another-post", hoursAgo(2)),
          ],
        },
      },
    ]);
    db.newsletterIssue.findMany.mockResolvedValue([
      {
        gmailMessageId: "18c0ffee18c0ffee",
        fromEmail: "lenny@substack.com",
        fromName: "Lenny's Newsletter",
        publicationKey: "lenny@substack.com",
        subject: "How to grow",
        snippet: "full issue",
        receivedAt: hoursAgo(3),
        webUrl: "https://www.lennysnewsletter.com/p/how-to-grow",
        imageUrl: "",
      },
    ]);

    const { aiItems } = await buildRankingCandidates({ userId: "u1", now });

    expect(aiItems.map((i) => [i.id, i.kind])).toEqual([
      ["rss:other", "article"],
      ["18c0ffee18c0ffee", "newsletter"],
    ]);
  });

  it("does not dedupe newsletters that have no web URL", async () => {
    db.userRssSubscription.findMany.mockResolvedValue([]);
    const issue = (id: string) => ({
      gmailMessageId: id,
      fromEmail: "a@b.com",
      fromName: "A",
      publicationKey: "a@b.com",
      subject: "Same subject",
      snippet: "same",
      receivedAt: hoursAgo(1),
      webUrl: null,
      imageUrl: "",
    });
    db.newsletterIssue.findMany.mockResolvedValue([issue("m1"), issue("m2")]);

    const { aiItems } = await buildRankingCandidates({ userId: "u1", now });

    expect(aiItems).toHaveLength(2);
  });
});
