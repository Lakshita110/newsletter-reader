import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { convert } from "html-to-text";

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function fallbackToText(html: string): string {
  return normalizeText(
    convert(html, {
      wordwrap: false,
      preserveNewlines: true,
      selectors: [
        { selector: "a", options: { ignoreHref: true } },
        { selector: "img", format: "skip" },
        { selector: "script", format: "skip" },
        { selector: "style", format: "skip" },
        { selector: "noscript", format: "skip" },
        { selector: "head", format: "skip" },
      ],
    })
  );
}

export function extractArticleContent(html: string, url?: string) {
  if (!html) return { html: "", text: "" };

  try {
    const dom = new JSDOM(html, url ? { url } : undefined);
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    const extractedHtml = article?.content?.trim() ?? "";
    const extractedText = normalizeText(article?.textContent?.trim() ?? "");

    if (extractedHtml && extractedText.length > 200) {
      return { html: extractedHtml, text: extractedText };
    }
  } catch {
    // fall through to fallback extraction
  }

  return { html, text: fallbackToText(html) };
}

