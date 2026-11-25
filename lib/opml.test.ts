import { describe, expect, it } from "vitest";
import { parseOpml } from "./opml";

describe("parseOpml", () => {
  it("reads feeds from nested outlines, decoding entities and skipping folders and duplicates", () => {
    const opml = `<?xml version="1.0"?><opml><body>
      <outline text="Tech">
        <outline type="rss" text="Ars" title="Ars Technica" xmlUrl="https://feeds.arstechnica.com/arstechnica/index"/>
        <outline type="rss" text="HN &amp; more" xmlUrl="https://hnrss.org/best?points=100&amp;x=1"/>
      </outline>
      <outline type="rss" text="Ars again" xmlUrl="https://feeds.arstechnica.com/arstechnica/index"/>
      <outline type="rss" text="bad" xmlUrl="javascript:alert(1)"/>
    </body></opml>`;
    expect(parseOpml(opml)).toEqual([
      { title: "Ars again", xmlUrl: "https://feeds.arstechnica.com/arstechnica/index" },
      { title: "HN & more", xmlUrl: "https://hnrss.org/best?points=100&x=1" },
    ]);
  });

  it("keeps a known category from the outline", () => {
    const feeds = parseOpml(`<opml><body>
      <outline text="Net Interest" xmlUrl="https://www.netinterest.co/feed" category="newsletter"/>
      <outline text="Lenny" xmlUrl="https://www.lennysnewsletter.com/feed" category="/Reading,newsletter"/>
      <outline text="NYT" xmlUrl="https://rss.nytimes.com/x.xml" category="Made Up"/>
    </body></opml>`);
    expect(feeds.map((f) => f.category)).toEqual(["newsletter", "newsletter", undefined]);
  });
});
