import { describe, expect, it } from "vitest";
import { splitForSpeech } from "./speech-chunks";

describe("splitForSpeech", () => {
  it("groups short sentences up to the limit", () => {
    const chunks = splitForSpeech("One. Two. Three is longer. Four.", 20);
    expect(chunks).toEqual(["One. Two.", "Three is longer.", "Four."]);
  });

  it("collapses whitespace and drops empties", () => {
    expect(splitForSpeech("  Hello\n\n world.   ")).toEqual(["Hello world."]);
    expect(splitForSpeech("   ")).toEqual([]);
  });

  it("breaks a run-on sentence without losing words", () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const chunks = splitForSpeech(words, 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join(" ").split(" ")).toEqual(words.split(" "));
  });
});
