/**
 * Pure helpers for highlights: text anchoring and Markdown export.
 *
 * Anchoring uses the quote plus up to CONTEXT_CHARS of text on each side
 * (the approach the W3C Web Annotation "TextQuoteSelector" uses). Offsets
 * into the DOM would break whenever the reader view changes or the article
 * is re-extracted; quoted text survives both.
 */

export const CONTEXT_CHARS = 32;

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}

export type QuoteAnchor = { quote: string; prefix?: string | null; suffix?: string | null };

/** Build the anchor for a selection at [start, end) of the container's text. */
export function anchorFor(fullText: string, start: number, end: number): QuoteAnchor {
  return {
    quote: fullText.slice(start, end),
    prefix: fullText.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: fullText.slice(end, end + CONTEXT_CHARS),
  };
}

/**
 * Find where an anchor sits in the text. When the quote occurs more than once
 * (e.g. "the" or a repeated phrase), pick the occurrence whose surrounding
 * text best matches the stored prefix/suffix. Whitespace differences are
 * ignored because view modes reflow the text.
 */
export function locateQuote(fullText: string, anchor: QuoteAnchor): { start: number; end: number } | null {
  const quote = anchor.quote;
  if (!quote.trim()) return null;

  // Map positions in whitespace-collapsed text back to the original.
  const map: number[] = [];
  let collapsed = "";
  let prevSpace = false;
  for (let i = 0; i < fullText.length; i++) {
    const isSpace = /\s/.test(fullText[i]);
    if (isSpace && prevSpace) continue;
    collapsed += isSpace ? " " : fullText[i];
    map.push(i);
    prevSpace = isSpace;
  }
  map.push(fullText.length);

  const needle = collapseWhitespace(quote);
  const prefix = collapseWhitespace(anchor.prefix ?? "");
  const suffix = collapseWhitespace(anchor.suffix ?? "");
  let best: { at: number; score: number } | null = null;
  for (let at = collapsed.indexOf(needle); at !== -1; at = collapsed.indexOf(needle, at + 1)) {
    const before = collapsed.slice(Math.max(0, at - prefix.length), at);
    const after = collapsed.slice(at + needle.length, at + needle.length + suffix.length);
    const score = sharedSuffixLength(before, prefix) + sharedPrefixLength(after, suffix);
    if (!best || score > best.score) best = { at, score };
  }
  if (!best) return null;
  return { start: map[best.at], end: map[best.at + needle.length - 1] + 1 };
}

function sharedSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function sharedPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

export type ExportHighlight = {
  itemId: string;
  itemTitle: string;
  publicationName: string | null;
  itemUrl: string | null;
  quote: string;
  note: string | null;
  createdAt: Date | string;
};

/**
 * Markdown grouped by article, newest article first, highlights in reading
 * order — ready to paste into Notion (which converts Markdown on paste) for
 * the Sunday synthesis note.
 */
export function highlightsToMarkdown(highlights: ExportHighlight[], heading?: string): string {
  const groups = new Map<string, ExportHighlight[]>();
  for (const h of highlights) {
    const list = groups.get(h.itemId) ?? [];
    list.push(h);
    groups.set(h.itemId, list);
  }
  const time = (h: ExportHighlight) => new Date(h.createdAt).getTime();
  const ordered = [...groups.values()].sort(
    (a, b) => Math.max(...b.map(time)) - Math.max(...a.map(time))
  );

  const lines: string[] = [];
  if (heading) lines.push(`# ${heading}`, "");
  for (const group of ordered) {
    const first = group[0];
    const title = first.itemUrl ? `[${first.itemTitle}](${first.itemUrl})` : first.itemTitle;
    lines.push(`## ${title}`);
    if (first.publicationName) lines.push(`*${first.publicationName}*`);
    lines.push("");
    for (const h of [...group].sort((a, b) => time(a) - time(b))) {
      lines.push(`> ${collapseWhitespace(h.quote).trim()}`);
      if (h.note?.trim()) lines.push("", `**Note:** ${h.note.trim()}`);
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}
