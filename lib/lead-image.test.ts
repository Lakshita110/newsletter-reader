import { describe, expect, it } from "vitest";
import { faviconDomain, pickLeadImage } from "./lead-image";

describe("pickLeadImage", () => {
  it("skips tracking pixels, logos, avatars and small images to find the story photo", () => {
    const html = `
      <img src="https://substack.com/o/open?token=abc" width="1" height="1">
      <img src="https://cdn.pub.com/logo.png" alt="Pub logo">
      <img src="https://cdn.pub.com/author.jpg" alt="avatar" width="40" height="40">
      <img src="https://cdn.pub.com/x.png" style="width:24px;height:24px">
      <img src="http://insecure.com/photo.jpg">
      <img src="https://substackcdn.com/image/fetch/w_1456/chip.jpg" width="728" alt="A chip fab">
    `;
    expect(pickLeadImage(html)).toBe("https://substackcdn.com/image/fetch/w_1456/chip.jpg");
  });

  it("accepts images with no declared size and decodes &amp;", () => {
    expect(pickLeadImage(`<img src='https://img.com/a.jpg?w=800&amp;q=80'>`)).toBe("https://img.com/a.jpg?w=800&q=80");
  });

  it("returns null when there is nothing but chrome", () => {
    expect(pickLeadImage(`<img src="https://x.com/spacer.gif"><img src="https://x.com/twitter-icon.png">`)).toBeNull();
    expect(pickLeadImage(null)).toBeNull();
  });
});

describe("faviconDomain", () => {
  it("prefers the post URL so a Substack shows its own publication's icon", () => {
    expect(faviconDomain("https://derekthompson.substack.com/p/x", "Derek <derekthompson@substack.com>")).toBe(
      "derekthompson.substack.com"
    );
    expect(faviconDomain("https://www.stratechery.com/2026/x", null)).toBe("stratechery.com");
  });

  it("falls back to the sender's domain without bulk-mail subdomains", () => {
    expect(faviconDomain(null, "Frontier <thefrontiersyndicate@mail.beehiiv.com>")).toBe("beehiiv.com");
    expect(faviconDomain(undefined, "Ben <email@stratechery.com>")).toBe("stratechery.com");
    expect(faviconDomain(null, "no email here")).toBeNull();
  });
});
