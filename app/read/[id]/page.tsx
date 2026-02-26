"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
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

export default function ReadPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : undefined;

  const [msg, setMsg] = useState<ReadMessage | null>(null);
  const [view, setView] = useState<"clean" | "original" | "text">("original");
  const [isMarkedRead, setIsMarkedRead] = useState(false);
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
      const res = await fetch(`/api/feed/item/${id}`);
      const data = await res.json();
      setMsg(data);
    })();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("nr_read_status_map");
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as Record<string, string>;
          setIsMarkedRead(parsed[id] === "read");
        } catch {
          setIsMarkedRead(false);
        }
      } else {
        setIsMarkedRead(false);
      }
    } else {
      setIsMarkedRead(false);
    }
    fetch("/api/read-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: id, state: "in_progress" }),
    }).catch(() => null);
  }, [id]);

  const markRead = () => {
    if (!id) return;
    setIsMarkedRead(true);
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
      body: JSON.stringify({ messageId: id, state: "read" }),
    }).catch(() => {
      setIsMarkedRead(false);
    });
  };

  const markUnread = () => {
    if (!id) return;
    setIsMarkedRead(false);
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
      setIsMarkedRead(true);
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
    const raw = msg.text || stripHtml(msg.html ?? "") || msg.snippet || "";
    const words = countWords(raw);
    // Hide mode toggles for very short content (roughly 1-2 sentences).
    return words > 45;
  }, [msg]);

  const nav = useMemo(() => {
    if (!id || orderedItems.length === 0) return null;
    const idx = orderedItems.findIndex((it) => it.id === id);
    if (idx === -1) return null;
    return {
      prev: orderedItems[idx - 1] ?? null,
      next: orderedItems[idx + 1] ?? null,
    };
  }, [id, orderedItems]);

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
        view={view}
        onViewChange={setView}
        onMarkRead={markRead}
        onMarkUnread={markUnread}
        isMarkedRead={isMarkedRead}
        showViewControls={showViewControls}
        externalUrl={msg.externalUrl}
      />

      <article>
        <ReaderContent message={msg} view={view} sanitized={sanitized} cleanedHtml={cleanedHtml} />
      </article>

      <ReaderNav nav={nav} />
    </main>
  );
}
