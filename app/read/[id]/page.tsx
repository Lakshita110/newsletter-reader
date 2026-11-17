"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ReaderContent } from "./components/ReaderContent";
import { ReaderHeader } from "./components/ReaderHeader";
import { ReaderNav } from "./components/ReaderNav";
import { ReaderToolbar, useReaderFontSize } from "./components/ReaderToolbar";
import { useReadingProgress } from "./lib/useReadingProgress";
import { useHighlights } from "./lib/useHighlights";
import { SummaryCard } from "./components/SummaryCard";
import { HighlightList, HighlightPaintStyle, SelectionBar } from "./components/HighlightControls";
import { toReadStatusMap, toSavedMap } from "@/app/inbox/lib/client-utils";
import { cleanHtml, countWords, sanitizeHtml, stripHtml, type ReadMessage } from "./lib/read-utils";

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

  const [msg, setMsg] = useState<ReadMessage | null>(null);
  const [view, setView] = useState<"clean" | "original" | "text">("original");
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
  const [savedById, setSavedById] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    const stored = window.localStorage.getItem("nr_saved_items_map");
    if (!stored) return {};
    try {
      const parsed = JSON.parse(stored) as Record<string, boolean>;
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
  // Set by the Today screen so Back returns there instead of a classic inbox.
  const [storedBackHref] = useState<string | null>(() =>
    typeof window === "undefined" ? null : window.localStorage.getItem("nr_reader_back")
  );
  const [fontSize, cycleFontSize] = useReaderFontSize();

  const fetchMessage = async (messageId: string, options?: { signal?: AbortSignal }): Promise<ReadMessage | null> => {
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

  useEffect(() => {
    let isMounted = true;
    (async () => {
      const res = await fetch("/api/read-state");
      if (!res.ok) return;
      const payload = await res.json();
      if (!isMounted) return;
      setStatusById(toReadStatusMap(payload));
      setSavedById(toSavedMap(payload));
    })().catch(() => null);
    return () => {
      isMounted = false;
    };
  }, []);

  const isMarkedRead = id ? statusById[id] === "read" : false;
  const isSaved = id ? savedById[id] === true : false;

  const markRead = useCallback(() => {
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
  }, [id, msg]);

  const markUnread = useCallback(() => {
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
  }, [id]);

  const toggleSaved = useCallback(() => {
    if (!id) return;
    const nextSaved = !isSaved;
    setSavedById((prev) => ({ ...prev, [id]: nextSaved }));
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("nr_saved_items_map");
      let parsed: Record<string, boolean> = {};
      try {
        parsed = stored ? (JSON.parse(stored) as Record<string, boolean>) : {};
      } catch {
        parsed = {};
      }
      if (nextSaved) parsed[id] = true;
      else delete parsed[id];
      window.localStorage.setItem("nr_saved_items_map", JSON.stringify(parsed));
    }
    fetch("/api/read-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId: id,
        state: nextSaved ? "saved" : "unsaved",
        metadata: msg
          ? {
              title: msg.subject || "(No subject)",
              sourceKind: msg.sourceKind,
              publicationName: msg.publicationName ?? msg.from,
            }
          : undefined,
      }),
    }).catch(() => {
      setSavedById((prev) => ({ ...prev, [id]: isSaved }));
    });
  }, [id, isSaved, msg]);

  const toggleRead = useCallback(() => {
    if (isMarkedRead) {
      markUnread();
      return;
    }
    markRead();
  }, [isMarkedRead, markRead, markUnread]);

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
    if (msg.sourceKind !== "gmail") return false;
    const raw = msg.text || stripHtml(msg.html ?? "") || msg.snippet || "";
    return countWords(raw) > 45;
  }, [msg]);

  const activeView = msg?.sourceKind && msg.sourceKind !== "gmail" ? "clean" : view;

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

  const backHref =
    storedBackHref ??
    (msg?.sourceKind === "web" ? "/today?tab=saved" : msg?.sourceKind === "rss" ? "/inbox/rss" : "/inbox/newsletters");
  const progress = useReadingProgress(id, Boolean(msg));
  const articleRef = useRef<HTMLElement>(null);
  const highlightMeta = useMemo(
    () =>
      msg && id
        ? {
            itemId: id,
            itemTitle: msg.subject || "(No subject)",
            publicationName: msg.publicationName ?? msg.from,
            itemUrl: msg.externalUrl ?? null,
          }
        : null,
    [id, msg]
  );
  const hl = useHighlights(articleRef, highlightMeta, `${id}:${activeView}:${msg ? 1 : 0}`);

  // "Done" = mark read and move to the next thing in the queue (or back to
  // the list when this was the last one). One thumb tap per article.
  const doneAndNext = useCallback(() => {
    if (!isMarkedRead) markRead();
    const next = nav?.next;
    if (next) router.push(`/read/${encodeURIComponent(next.id)}`);
    else router.push(backHref);
  }, [backHref, isMarkedRead, markRead, nav, router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      if (event.key === "b") {
        event.preventDefault();
        router.push(backHref);
        return;
      }
      if (event.key === "r") {
        event.preventDefault();
        toggleRead();
        return;
      }
      if (event.key === "s") {
        event.preventDefault();
        toggleSaved();
        return;
      }
      if (event.key === "f") {
        if (msg?.externalUrl) {
          event.preventDefault();
          window.open(msg.externalUrl, "_blank", "noopener,noreferrer");
        }
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
  }, [backHref, msg?.externalUrl, nav, router, toggleRead, toggleSaved]);

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
      className="reader-main"
      style={{
        maxWidth: 680,
        margin: "56px auto",
        padding: "0 20px",
        lineHeight: 1.7,
        fontSize: 17,
        ["--reader-font-size" as string]: `${fontSize}px`,
      }}
    >
      <div className="reader-progress" style={{ width: `${progress.pct}%` }} aria-hidden />
      <ReaderHeader
        message={msg}
        readingMinutes={readingMinutes}
        view={activeView}
        onViewChange={setView}
        onToggleRead={toggleRead}
        onToggleSaved={toggleSaved}
        isMarkedRead={isMarkedRead}
        isSaved={isSaved}
        showViewControls={showViewControls}
        externalUrl={msg.externalUrl}
        backHref={backHref}
      />

      <SummaryCard key={id} itemId={id} minutes={readingMinutes} />

      <article className="reader-content-shell" ref={articleRef}>
        <ReaderContent message={msg} view={activeView} sanitized={sanitized} cleanedHtml={cleanedHtml} />
      </article>

      <HighlightPaintStyle />
      <HighlightList highlights={hl.highlights} onUpdateNote={hl.updateNote} onRemove={hl.remove} />

      <ReaderNav nav={nav} />

      {hl.selection && <SelectionBar key={`${hl.selection.start}-${hl.selection.end}`} onHighlight={hl.create} />}

      {progress.resumePct !== null && (
        <button type="button" className="reader-resume" onClick={progress.resume}>
          Resume at {Math.round(progress.resumePct)}%
        </button>
      )}

      <ReaderToolbar
        backHref={backHref}
        isSaved={isSaved}
        onToggleSaved={toggleSaved}
        onDone={doneAndNext}
        doneLabel={nav?.next ? "Done → Next" : "Done"}
        externalUrl={msg.externalUrl}
        onCycleFont={cycleFontSize}
      />
    </main>
  );
}
