import { convert } from "html-to-text";

let readabilityCtor: (typeof import("@mozilla/readability"))["Readability"] | null | undefined;
let jsdomCtor: (typeof import("jsdom"))["JSDOM"] | null | undefined;

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

async function getReadabilityDeps() {
  if (readabilityCtor !== undefined && jsdomCtor !== undefined) {
    return { Readability: readabilityCtor, JSDOM: jsdomCtor };
  }

  try {
    const [readabilityModule, jsdomModule] = await Promise.all([
      import("@mozilla/readability"),
      import("jsdom"),
    ]);
    readabilityCtor = readabilityModule.Readability;
    jsdomCtor = jsdomModule.JSDOM;
  } catch {
    readabilityCtor = null;
    jsdomCtor = null;
  }

  return { Readability: readabilityCtor, JSDOM: jsdomCtor };
}

export async function extractArticleContent(html: string, url?: string) {
  if (!html) return { html: "", text: "" };

  try {
    const { Readability, JSDOM } = await getReadabilityDeps();
    if (Readability && JSDOM) {
      const dom = new JSDOM(html, url ? { url } : undefined);
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      const extractedHtml = article?.content?.trim() ?? "";
      const extractedText = normalizeText(article?.textContent?.trim() ?? "");

      if (extractedHtml && extractedText.length > 200) {
        return { html: extractedHtml, text: extractedText };
      }
    }
  } catch {
    // fall through to fallback extraction
  }

  return { html, text: fallbackToText(html) };
}
