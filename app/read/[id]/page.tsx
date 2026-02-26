"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import DOMPurify from "isomorphic-dompurify";
import parse from "html-react-parser";

type Message = {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  html?: string;
  text?: string;
};

export default function ReadPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : undefined;

  const [msg, setMsg] = useState<Message | null>(null);
  const [view, setView] = useState<"clean" | "original" | "text">("clean");
  const [orderedItems, setOrderedItems] = useState<
    { id: string; subject: string }[]
  >([]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const res = await fetch(`/api/gmail/message/${id}`);
      const data = await res.json();
      setMsg(data);
    })();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetch("/api/read-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: id }),
    }).catch(() => null);
  }, [id]);

  useEffect(() => {
    const stored = window.localStorage.getItem("nr_ordered_items");
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as { id: string; subject: string }[];
      setOrderedItems(Array.isArray(parsed) ? parsed : []);
    } catch {
      setOrderedItems([]);
    }
  }, [id]);

  const sanitized = useMemo(() => {
    const html = msg?.html ?? "";
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }, [msg?.html]);

  const cleanedHtml = useMemo(() => {
    if (!sanitized) return "";
    let html = sanitized;
    html = html.replace(/<head[\s\S]*?<\/head>/gi, "");
    html = html.replace(/<style[\s\S]*?<\/style>/gi, "");
    html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    html = html.replace(/<(meta|link|title)[^>]*>/gi, "");
    html = html.replace(/\sstyle=(".*?"|'.*?'|[^\s>]+)/gi, "");
    html = html.replace(/\s(class|id)=(".*?"|'.*?'|[^\s>]+)/gi, "");
    return html;
  }, [sanitized]);

  const readingMinutes = useMemo(() => {
    if (!msg) return null;
    const raw =
      msg.text ??
      stripHtml(msg.html ?? "") ??
      msg.snippet ??
      "";
    const words = countWords(raw);
    if (!words) return null;
    return Math.max(1, Math.round(words / 220));
  }, [msg]);

  const content = useMemo(() => {
    if (!msg) return null;

    if (view === "text") {
      return (
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
          {msg.text ?? stripHtml(msg.html ?? "") ?? msg.snippet ?? ""}
        </pre>
      );
    }

    if (view === "clean") {
      if (!cleanedHtml.trim()) {
        return (
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
            {stripHtml(msg.html ?? "") ?? msg.snippet ?? ""}
          </pre>
        );
      }
      return (
        <div>
          {parse(cleanedHtml, {
            replace: (node) => {
              if (shouldDropNode(node)) return <></>;
              if (
                node &&
                typeof node === "object" &&
                "name" in node &&
                (node as any).name === "img"
              ) {
                const attribs = (node as any).attribs ?? {};
                const src = attribs.src as string | undefined;
                const alt = attribs.alt as string | undefined;
                return <DeferredImage src={src} alt={alt} />;
              }
              return undefined;
            },
          })}
        </div>
      );
    }

    // Even original must be sanitized
    return <div>{parse(sanitized)}</div>;
  }, [msg, view, sanitized]);

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
      <div style={{ marginBottom: 14 }}>
        <Link
          href="/inbox"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: "var(--muted)",
          }}
        >
          Back to inbox
        </Link>
      </div>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
          {msg.subject || "(No subject)"}
        </h1>
        <div style={{ opacity: 0.8, marginBottom: 6 }}>{msg.from}</div>
        <div style={{ opacity: 0.6, marginBottom: 12 }}>
          {formatDateTime(msg.date)}
        </div>
        {readingMinutes !== null && (
          <div style={{ opacity: 0.6, marginBottom: 12 }}>
            {readingMinutes} min read
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setView("clean")}>Clean</button>
          <button onClick={() => setView("original")}>Original</button>
          <button onClick={() => setView("text")}>Text</button>
        </div>
      </header>

      <article>{content}</article>

      {(nav?.prev || nav?.next) && (
        <div style={{ marginTop: 28, borderTop: "1px solid var(--faint)" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              paddingTop: 14,
              fontSize: 13,
              color: "var(--muted)",
            }}
          >
            {nav?.prev ? (
              <Link href={`/read/${nav.prev.id}`}>
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            {nav?.next ? (
              <Link href={`/read/${nav.next.id}`}>
                Next →
              </Link>
            ) : (
              <span />
            )}
          </div>

          {nav?.next && (
            <div style={{ marginTop: 10, fontSize: 14 }}>
              Next up:{" "}
              <Link href={`/read/${nav.next.id}`}>
                {nav.next.subject} →
              </Link>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function stripHtml(html: string): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ");
}

function countWords(text: string): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const sameYear = parsed.getFullYear() === new Date().getFullYear();
  const date = parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  const time = parsed.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}

function shouldDropNode(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const anyNode = node as any;
  if (anyNode.type !== "tag") return false;

  const name = anyNode.name as string | undefined;
  const attribs = anyNode.attribs ?? {};
  const className = `${attribs.class ?? ""}`.toLowerCase();
  const id = `${attribs.id ?? ""}`.toLowerCase();
  const text = getNodeText(anyNode).toLowerCase();

  const classHit = /(social|share|follow|footer|icon-row|icons|banner)/.test(
    className
  );
  const idHit = /(social|share|follow|footer|icons|banner)/.test(id);
  const textHit =
    /view in browser|view online|open in browser|unsubscribe/.test(text);

  if (classHit || idHit || textHit) return true;

  if (name === "table" && /social|share|footer|icons/.test(text)) {
    return true;
  }

  return false;
}

function getNodeText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.data ?? "";
  if (!Array.isArray(node.children)) return "";
  return node.children.map(getNodeText).join(" ");
}

function DeferredImage({ src, alt }: { src?: string; alt?: string }) {
  const [loaded, setLoaded] = useState(false);

  if (!src) return null;

  if (!loaded) {
    return (
      <button
        type="button"
        onClick={() => setLoaded(true)}
        style={{
          margin: "12px 0",
          padding: "6px 10px",
          borderRadius: 10,
          border: "1px solid var(--faint)",
          background: "#f1f5ff",
          color: "var(--accent-blue)",
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        Load image
      </button>
    );
  }

  return (
    <img
      src={src}
      alt={alt ?? ""}
      loading="lazy"
      style={{
        maxWidth: "100%",
        height: "auto",
        borderRadius: 12,
        display: "block",
        margin: "12px 0",
      }}
    />
  );
}
