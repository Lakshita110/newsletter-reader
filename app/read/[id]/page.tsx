"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ReaderContent } from "./components/ReaderContent";
import { ReaderHeader } from "./components/ReaderHeader";
import { ReaderNav } from "./components/ReaderNav";
import { HighlightPopover } from "./components/HighlightPopover";
import {
  cleanHtml,
  countWords,
  sanitizeHtml,
  stripHtml,
  type ReadMessage,
} from "./lib/read-utils";

type Popover = { text: string; x: number; y: number };

function isTypingTarget(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node) return false;
  return node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable;
}

export default function ReadPage() {
  const params = useParams();
  const router = useRouter();
  const rawId = typeof params?.id === "string" ? params.id : undefined;
  const id = useMemo(() => {
    if (!rawId) return undefined;
    let decoded = rawId;
    for (let i = 0; i < 2; i++) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch {
        break;
      }
    }
    return decoded;
  }, [rawId]);

  const articleRef = useRef<HTMLElement>(null);
  const [msg, setMsg] = useState<ReadMessage | null>(null);
  const [view, setView] = useState<"clean" | "original" | "text">("original");
  const [highlights, setHighlights] = useState<string[]>([]);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [savingHighlight, setSavingHighlight] = useState(false);
  const [statusById, setStatusById] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    const stored = window.localStorage.getItem("nr_read_status_map");
    if (!stored) return {};
    try {
      const parsed = JSON.parse(stored) as Record<string, string>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
  const [orderedItems] = useState<{ id: string; subject: string }[]>(() => {
    if (typeof window === "undefined") return [];
    const stored = window.localStorage.getItem("nr_ordered_items");
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored) as { id: string; subject: string }[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const prefetchedByIdRef = useRef<Record<string, ReadMessage>>({});

  const fetchMessage = async (
    messageId: string,
    options?: { signal?: AbortSignal }
  ): Promise<ReadMessage | null> => {
    const cached = prefetchedByIdRef.current[messageId];
    if (cached) return cached;
    const res = await fetch(`/api/feed/item/${encodeURIComponent(messageId)}`, {
      signal: options?.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ReadMessage;
    prefetchedByIdRef.current[messageId] = data;
    return data;
  };

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    (async () => {
      const data = await fetchMessage(id, { signal: controller.signal });
      if (data) setMsg(data);
    })().catch(() => null);
    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetch("/api/read-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: id, state: "in_progress" }),
    }).catch(() => null);
  }, [id]);

  const isMarkedRead = id ? statusById[id] === "read" : false;

  const markRead = () => {
    if (!id) return;
    setStatusById((prev) => ({ ...prev, [id]: "read" }));
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("nr_read_status_map");
      let parsed: Record<string, string> = {};
      try {
        parsed = stored ? (JSON.parse(stored) as Record<string, string>) : {};
      } catch {
        parsed = {};
      }
      parsed[id] = "read";
      window.localStorage.setItem("nr_read_status_map", JSON.stringify(parsed));
    }
    fetch("/api/read-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId: id,
        state: "read",
        metadata: msg
          ? {
              title: msg.subject || "(No subject)",
              sourceKind: msg.sourceKind,
              publicationName: msg.publicationName ?? msg.from,
            }
          : undefined,
      }),
    }).catch(() => {
      setStatusById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });
  };

  const markUnread = () => {
    if (!id) return;
    setStatusById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("nr_read_status_map");
      let parsed: Record<string, string> = {};
      try {
        parsed = stored ? (JSON.parse(stored) as Record<string, string>) : {};
      } catch {
        parsed = {};
      }
      delete parsed[id];
      window.localStorage.setItem("nr_read_status_map", JSON.stringify(parsed));
    }
    fetch("/api/read-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: id, state: "unread" }),
    }).catch(() => {
      setStatusById((prev) => ({ ...prev, [id]: "read" }));
    });
  };

  // Load existing highlights for RSS items
  useEffect(() => {
    if (!id || !msg || msg.sourceKind !== "rss") return;
    fetch(`/api/highlights?rssItemId=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((data: { text: string }[]) => {
        if (Array.isArray(data)) setHighlights(data.map((h) => h.text));
      })
      .catch(() => null);
  }, [id, msg]);

  // Apply mark.js highlighting after content renders
  useEffect(() => {
    if (!articleRef.current || highlights.length === 0) return;
    import("mark.js").then(({ default: Mark }) => {
      const instance = new Mark(articleRef.current!);
      instance.unmark({
        done: () => {
          for (const text of highlights) {
            instance.mark(text, { separateWordSearch: false, acrossElements: true });
          }
        },
      });
    });
  }, [highlights, msg]);

  const handleMouseUp = useCallback(() => {
    if (!articleRef.current) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      setPopover(null);
      return;
    }
    const text = selection.toString().trim();
    if (!text) {
      setPopover(null);
      return;
    }
    // Only show popover if selection is within article
    const range = selection.getRangeAt(0);
    if (!articleRef.current.contains(range.commonAncestorContainer)) {
      setPopover(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setPopover({ text, x: rect.left + rect.width / 2, y: rect.top + window.scrollY });
  }, []);

  const saveHighlight = useCallback(async () => {
    if (!popover || !id || !msg || msg.sourceKind !== "rss") return;
    setSavingHighlight(true);
    try {
      await fetch("/api/highlights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rssItemId: id, text: popover.text }),
      });
      setHighlights((prev) => [...prev, popover.text]);
      window.getSelection()?.removeAllRanges();
      setPopover(null);
    } catch {
      // ignore
    } finally {
      setSavingHighlight(false);
    }
  }, [popover, id, msg]);

  const sanitized = useMemo(() => sanitizeHtml(msg?.html ?? ""), [msg?.html]);
  const cleanedHtml = useMemo(() => cleanHtml(sanitized), [sanitized]);

  const readingMinutes = useMemo(() => {
    if (!msg) return null;
    const raw = msg.text || stripHtml(msg.html ?? "") || msg.snippet || "";
    const words = countWords(raw);
    if (!words) return null;
    return Math.max(1, Math.round(words / 220));
  }, [msg]);

  const showViewControls = useMemo(() => {
    if (!msg) return false;
    if (msg.sourceKind === "rss") return false;
    const raw = msg.text || stripHtml(msg.html ?? "") || msg.snippet || "";
    return countWords(raw) > 45;
  }, [msg]);

  const activeView = msg?.sourceKind === "rss" ? "clean" : view;

  const nav = useMemo(() => {
    if (!id || orderedItems.length === 0) return null;
    const idx = orderedItems.findIndex((it) => it.id === id);
    if (idx === -1) return null;
    return {
      prev: orderedItems[idx - 1] ?? null,
      next: orderedItems[idx + 1] ?? null,
    };
  }, [id, orderedItems]);

  useEffect(() => {
    const neighbors = [nav?.prev?.id, nav?.next?.id].filter(
      (value): value is string => typeof value === "string" && value.length > 0
    );
    if (neighbors.length === 0) return;
    const controller = new AbortController();
    for (const itemId of neighbors) {
      router.prefetch(`/read/${encodeURIComponent(itemId)}`);
      fetchMessage(itemId, { signal: controller.signal }).catch(() => null);
    }
    return () => controller.abort();
  }, [nav?.next?.id, nav?.prev?.id, router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      const backHref = msg?.sourceKind === "rss" ? "/inbox/rss" : "/inbox/newsletters";
      if (event.key === "u") {
        event.preventDefault();
        router.push(backHref);
        return;
      }

      if (event.key === "ArrowLeft" && nav?.prev) {
        event.preventDefault();
        router.push(`/read/${encodeURIComponent(nav.prev.id)}`);
        return;
      }
      if (event.key === "ArrowRight" && nav?.next) {
        event.preventDefault();
        router.push(`/read/${encodeURIComponent(nav.next.id)}`);
        return;
      }
      if (event.key === "j") {
        event.preventDefault();
        window.scrollBy({ top: Math.round(window.innerHeight * 0.75), behavior: "smooth" });
        return;
      }
      if (event.key === "k") {
        event.preventDefault();
        window.scrollBy({ top: -Math.round(window.innerHeight * 0.75), behavior: "smooth" });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [msg?.sourceKind, nav, router]);

  if (!id) {
    return (
      <main style={{ padding: 24 }}>
        <p>Missing message id in route.</p>
      </main>
    );
  }

  if (!msg) {
    return (
      <main style={{ padding: 24 }}>
        <p>Loading...</p>
      </main>
    );
  }

  return (
    <main
      style={{
        maxWidth: 680,
        margin: "56px auto",
        padding: "0 20px",
        lineHeight: 1.7,
        fontSize: 17,
      }}
    >
      <ReaderHeader
        message={msg}
        readingMinutes={readingMinutes}
        view={activeView}
        onViewChange={setView}
        onMarkRead={markRead}
        onMarkUnread={markUnread}
        isMarkedRead={isMarkedRead}
        showViewControls={showViewControls}
        externalUrl={msg.externalUrl}
      />

      <article
        ref={articleRef}
        className="reader-content-shell"
        onMouseUp={msg.sourceKind === "rss" ? handleMouseUp : undefined}
      >
        <ReaderContent
          message={msg}
          view={activeView}
          sanitized={sanitized}
          cleanedHtml={cleanedHtml}
        />
      </article>

      {popover && msg.sourceKind === "rss" && (
        <HighlightPopover
          x={popover.x}
          y={popover.y}
          saving={savingHighlight}
          onSave={saveHighlight}
        />
      )}

      <ReaderNav nav={nav} />
    </main>
  );
}
