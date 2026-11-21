import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session-user", () => ({ getSessionUserId: async () => "u1" }));

const db = {
  rssSource: { upsert: vi.fn() },
  userRssSubscription: { upsert: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const fetchFeedTitle = vi.fn();
const syncRssSource = vi.fn();
vi.mock("@/lib/rss", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rss")>()),
  fetchFeedTitle: (url: string) => fetchFeedTitle(url),
  syncRssSource: (id: string) => syncRssSource(id),
}));

const { POST } = await import("./route");

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/sources/rss", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  db.rssSource.upsert.mockResolvedValue({ id: "src1" });
  db.userRssSubscription.upsert.mockResolvedValue({ id: "sub1" });
  syncRssSource.mockResolvedValue({ inserted: 3 });
});

describe("POST /api/sources/rss", () => {
  it("adds a Substack from just its name, using the feed's title and syncing right away", async () => {
    fetchFeedTitle.mockResolvedValue("Lenny's Newsletter");
    const res = await post({ rssUrl: "lenny" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, name: "Lenny's Newsletter" });
    expect(fetchFeedTitle).toHaveBeenCalledWith("https://lenny.substack.com/feed");
    expect(db.rssSource.upsert.mock.calls[0][0].create).toMatchObject({
      name: "Lenny's Newsletter",
      rssUrl: "https://lenny.substack.com/feed",
    });
    expect(db.userRssSubscription.upsert.mock.calls[0][0].create.category).toBe("other");
    expect(syncRssSource).toHaveBeenCalledWith("src1");
  });

  it("finds a website's feed when given the site instead of the feed", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response('<link rel="alternate" type="application/rss+xml" href="/blog/rss.xml">', { status: 200 })
        )
    );
    fetchFeedTitle.mockImplementation(async (url: string) => {
      if (url === "https://simonwillison.net/blog/rss.xml") return "Simon Willison's Weblog";
      throw new Error("Not a feed");
    });
    const res = await post({ rssUrl: "simonwillison.net" });
    expect(res.status).toBe(200);
    expect(db.rssSource.upsert.mock.calls[0][0].create.rssUrl).toBe("https://simonwillison.net/blog/rss.xml");
    vi.unstubAllGlobals();
  });

  it("rejects a URL with no readable feed instead of saving a broken source", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html></html>", { status: 200 })));
    fetchFeedTitle.mockRejectedValue(new Error("Status code 404"));
    const res = await post({ rssUrl: "https://example.com/nope" });
    expect(res.status).toBe(400);
    expect(db.rssSource.upsert).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
