import { describe, expect, it } from "vitest";
import { countSourceCoverage } from "./story-buzz";

const story = (id: string, sourceName: string, title: string, snippet = "") => ({ id, sourceName, title, snippet });

describe("countSourceCoverage", () => {
  it("counts other outlets running the same big story, even without names in the headline", () => {
    const counts = countSourceCoverage([
      story("ft", "Financial Times", "Stocks tumble as bond yields jump", "Global equities sold off sharply"),
      story("wsj", "WSJ Markets", "Stock market tumbles as Treasury yields jump", "Equities sold off"),
      story("nyt", "NYT Business", "Wall Street stocks tumble, yields jump to highest since 2007"),
      story("eco", "The Economist", "The surprising joy of competitive birdwatching"),
    ]);
    expect(counts.get("ft")).toBe(2);
    expect(counts.get("wsj")).toBe(2);
    expect(counts.get("eco")).toBe(0);
  });

  it("matches on shared names", () => {
    const counts = countSourceCoverage([
      story("a", "FT", "Ukraine offered path to NATO membership"),
      story("b", "NYT World", "NATO leaders invite Ukraine to begin accession talks"),
      story("c", "WSJ", "Nvidia earnings beat estimates"),
    ]);
    expect(counts.get("a")).toBe(1);
    expect(counts.get("c")).toBe(0);
  });

  it("doesn't count the same source twice or itself", () => {
    const counts = countSourceCoverage([
      story("a", "FT", "Stocks tumble as bond yields jump"),
      story("b", "FT", "Stocks tumble again as bond yields jump further"),
    ]);
    expect(counts.get("a")).toBe(0);
  });
});
