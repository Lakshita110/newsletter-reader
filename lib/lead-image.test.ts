import { describe, expect, it } from "vitest";
import { faviconDomain } from "./lead-image";

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
