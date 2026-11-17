"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import { anchorFor, locateQuote } from "@/lib/highlight-helpers";

export type HighlightRow = {
  id: string;
  quote: string;
  prefix: string | null;
  suffix: string | null;
  note: string | null;
  createdAt: string;
};

type ItemMeta = { itemId: string; itemTitle: string; publicationName?: string; itemUrl?: string | null };

const HIGHLIGHT_NAME = "reader-highlight";

/** Turn [start, end) character offsets in container.textContent into a DOM Range. */
function rangeFromOffsets(container: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let pos = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const len = node.textContent?.length ?? 0;
    if (!started && start < pos + len) {
      range.setStart(node, start - pos);
      started = true;
    }
    if (started && end <= pos + len) {
      range.setEnd(node, end - pos);
      return range;
    }
    pos += len;
  }
  return null;
}

/** Character offset of a (node, offset) point inside the container's text. */
function offsetWithin(container: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(container, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

/**
 * Highlights for one article.
 *
 * Painting uses the CSS Custom Highlight API instead of wrapping text in
 * <mark> elements: the article DOM is owned by React (html-react-parser), and
 * mutating it would break reconciliation on the next view switch. The API
 * paints ranges without touching the DOM (Safari 17.2+, Chrome 105+); on older
 * browsers highlights still save and show in the list below the article.
 */
export function useHighlights(containerRef: RefObject<HTMLElement | null>, meta: ItemMeta | null, renderKey: string) {
  const [highlights, setHighlights] = useState<HighlightRow[]>([]);
  const [selection, setSelection] = useState<{ start: number; end: number; text: string } | null>(null);
  const itemId = meta?.itemId;

  useEffect(() => {
    if (!itemId) return;
    const controller = new AbortController();
    fetch(`/api/highlights?itemId=${encodeURIComponent(itemId)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: HighlightRow[]) => setHighlights(rows))
      .catch(() => null);
    return () => controller.abort();
  }, [itemId]);

  // Paint (and repaint after the article or view changes).
  useEffect(() => {
    const container = containerRef.current;
    const registry =
      typeof CSS !== "undefined" ? (CSS as unknown as { highlights?: Map<string, unknown> }).highlights : undefined;
    const HighlightCtor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!container || !registry || !HighlightCtor) return;
    const raf = requestAnimationFrame(() => {
      const text = container.textContent ?? "";
      const ranges = highlights
        .map((h) => locateQuote(text, h))
        .filter((loc): loc is { start: number; end: number } => loc !== null)
        .map((loc) => rangeFromOffsets(container, loc.start, loc.end))
        .filter((r): r is Range => r !== null);
      registry.set(HIGHLIGHT_NAME, new HighlightCtor(...ranges));
    });
    return () => {
      cancelAnimationFrame(raf);
      registry.delete(HIGHLIGHT_NAME);
    };
  }, [containerRef, highlights, renderKey]);

  // Track a text selection inside the article.
  useEffect(() => {
    const onChange = () => {
      const container = containerRef.current;
      const sel = window.getSelection();
      if (!container || !sel || sel.isCollapsed || sel.rangeCount === 0) {
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) {
        setSelection(null);
        return;
      }
      const start = offsetWithin(container, range.startContainer, range.startOffset);
      const end = offsetWithin(container, range.endContainer, range.endOffset);
      const text = (container.textContent ?? "").slice(start, end);
      setSelection(text.trim().length >= 3 ? { start, end, text } : null);
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [containerRef]);

  const create = useCallback(
    async (note?: string) => {
      const container = containerRef.current;
      if (!container || !selection || !meta) return;
      const anchor = anchorFor(container.textContent ?? "", selection.start, selection.end);
      const res = await fetch("/api/highlights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...meta, ...anchor, note }),
      });
      if (!res.ok) {
        console.error("[highlights] save failed", res.status);
        return;
      }
      const row = (await res.json()) as HighlightRow;
      setHighlights((prev) => [...prev, row]);
      window.getSelection()?.removeAllRanges();
      setSelection(null);
    },
    [containerRef, meta, selection]
  );

  const updateNote = useCallback(async (id: string, note: string) => {
    setHighlights((prev) => prev.map((h) => (h.id === id ? { ...h, note: note.trim() || null } : h)));
    await fetch(`/api/highlights/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
  }, []);

  const remove = useCallback(async (id: string) => {
    setHighlights((prev) => prev.filter((h) => h.id !== id));
    await fetch(`/api/highlights/${encodeURIComponent(id)}`, { method: "DELETE" });
  }, []);

  return { highlights, selection, create, updateNote, remove };
}
