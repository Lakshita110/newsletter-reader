"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ReaderContent } from "./components/ReaderContent";
import { ReaderHeader } from "./components/ReaderHeader";
import { ReaderNav } from "./components/ReaderNav";
import {
  cleanHtml,
  countWords,
  sanitizeHtml,
  stripHtml,
  type ReadMessage,
} from "./lib/read-utils";

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

  useEffect(() => {
    if (!id) return;
    (async () => {
      const res = await fetch(`/api/feed/item/${encodeURIComponent(id)}`);
      const data = await res.json();
      setMsg(data);
    })();
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

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
  }, [nav, router]);

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

      <article className="reader-content-shell">
        <ReaderContent
          message={msg}
          view={activeView}
          sanitized={sanitized}
          cleanedHtml={cleanedHtml}
        />
      </article>

      <ReaderNav nav={nav} />
    </main>
  );
}
