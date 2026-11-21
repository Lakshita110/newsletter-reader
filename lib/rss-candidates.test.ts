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

function rssItem(id: string, link: string, publishedAt: Date, title = `Story ${id}`) {
  return {
    id,
    title,
    author: null,
    link,
    imageUrl: null,
    htmlRaw: null,
    snippet: "teaser",
    publishedAt,
    createdAt: publishedAt,
  };
}

const subscription = (id: string, name: string, items: ReturnType<typeof rssItem>[]) => ({
  category: "news",
  source: { id, name, items },
});

beforeEach(() => {
  vi.clearAllMocks();
  db.messageReadStat.findMany.mockResolvedValue([]);
  db.newsletterIssue.findMany.mockResolvedValue([]);
});

describe("buildRankingCandidates", () => {
  it("drops an RSS copy of a post that already arrived as a newsletter email", async () => {
    db.userRssSubscription.findMany.mockResolvedValue([
      subscription("src1", "Lenny's Newsletter", [
        rssItem("dup", "https://www.lennysnewsletter.com/p/how-to-grow?utm_source=rss", hoursAgo(1)),
        rssItem("other", "https://www.lennysnewsletter.com/p/another-post", hoursAgo(2)),
      ]),
    ]);
    db.newsletterIssue.findMany.mockResolvedValue([{ webUrl: "https://www.lennysnewsletter.com/p/how-to-grow" }]);

    const { aiItems } = await buildRankingCandidates({ userId: "u1", now });

    expect(aiItems.map((i) => i.id)).toEqual(["rss:other"]);
  });

  it("annotates each story with how many other sources cover it", async () => {
    db.userRssSubscription.findMany.mockResolvedValue([
      subscription("ft", "Financial Times", [
        rssItem("ft1", "https://ft.com/a", hoursAgo(1), "Ukraine offered NATO membership path"),
      ]),
      subscription("nyt", "NYT World", [
        rssItem("nyt1", "https://nyt.com/b", hoursAgo(2), "NATO invites Ukraine to accession talks"),
      ]),
      subscription("eco", "The Economist", [
        rssItem("eco1", "https://economist.com/c", hoursAgo(3), "The joy of birdwatching"),
      ]),
    ]);

    const { aiItems } = await buildRankingCandidates({ userId: "u1", now });

    expect(Object.fromEntries(aiItems.map((i) => [i.id, i.coverage]))).toEqual({
      "rss:ft1": 1,
      "rss:nyt1": 1,
      "rss:eco1": 0,
    });
  });
});
