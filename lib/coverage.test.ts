import { describe, expect, it } from "vitest";
import { extractEntities, findCoverage, htmlToPlainText } from "./coverage";

describe("extractEntities", () => {
  it("pulls proper nouns and acronyms, dropping stopwords and possessives", () => {
    expect(extractEntities("Nvidia's China sales slump as the US tightens rules")).toEqual(["Nvidia", "China", "US"]);
    expect(extractEntities("The OpenAI and Microsoft deal, explained")).toEqual(["OpenAI", "Microsoft"]);
  });
  it("finds nothing in a generic headline", () => {
    expect(extractEntities("Markets rally as rates ease")).toEqual(["Markets"]);
  });
});

const strat = {
  id: "g1",
  publicationName: "Stratechery",
  subject: "The AI capex question",
  text: "This week Nvidia reported results; its China business remains constrained by US export rules. Microsoft's capex...",
};

describe("findCoverage", () => {
  it("flags a story whose names appear in a newsletter", () => {
    const c = findCoverage("Nvidia's China sales slump as US tightens rules", [strat]);
    expect(c).toMatchObject({ byId: "g1", publicationName: "Stratechery" });
    expect(c?.matched).toEqual(["Nvidia", "China", "US"]);
  });
  it("needs at least two names and a majority of them", () => {
    expect(findCoverage("Markets rally as rates ease", [strat])).toBeNull();
    expect(findCoverage("Nvidia hires Tesla, Apple and Google veterans for Paris lab", [strat])).toBeNull();
  });
  it("matches whole words only", () => {
    const src = { ...strat, text: "Chinatown restaurants and USB chargers" };
    expect(findCoverage("China and US sign trade pact", [src])).toBeNull();
  });
});

describe("htmlToPlainText", () => {
  it("strips tags, scripts, and entities", () => {
    expect(htmlToPlainText("<style>x{}</style><p>Apple&nbsp;&amp; <b>Google</b></p>").trim()).toBe("Apple & Google");
  });
});
