"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { buildBookmarklet } from "@/lib/saved-article-helpers";

const SHORTCUT_JS = `completion(JSON.stringify({url: location.href, title: document.title, html: document.documentElement.outerHTML}));`;

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="filter-action-btn"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/**
 * How to get links in from outside the app. The interesting case is
 * paywalled news: the server can't log in to WSJ/FT/NYT, so instead the
 * page you are already reading (logged in) sends its own HTML.
 */
export default function SaveAnywhereSection() {
  const [token, setToken] = useState<string | null>(null);
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));
  const [error, setError] = useState<string | null>(null);
  const bookmarkletRef = useRef<HTMLAnchorElement>(null);

  const load = (rotate = false) =>
    fetch("/api/save/token", { method: rotate ? "POST" : "GET", cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => setToken(data.token))
      .catch(() => setError("Couldn't load your save link."));

  useEffect(() => {
    load();
  }, []);

  const bookmarklet = token && origin ? buildBookmarklet(origin, token) : "";
  // React refuses javascript: hrefs in JSX, so set it on the element directly.
  useEffect(() => {
    if (bookmarkletRef.current && bookmarklet) bookmarkletRef.current.setAttribute("href", bookmarklet);
  }, [bookmarklet]);

  const step: React.CSSProperties = { margin: "6px 0", fontSize: 13, lineHeight: 1.5 };
  const code: React.CSSProperties = {
    display: "block",
    fontFamily: "var(--font-mono), monospace",
    fontSize: 11,
    background: "var(--surface-muted)",
    border: "1px solid var(--faint)",
    borderRadius: 8,
    padding: "6px 8px",
    margin: "4px 0",
    overflowWrap: "anywhere",
  };

  return (
    <section style={{ marginBottom: 18, borderBottom: "1px solid var(--faint)", paddingBottom: 16 }}>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>Save from anywhere</div>
      <p style={{ ...step, color: "var(--muted)" }}>
        Links you save land in <Link href="/today?tab=saved">Saved</Link>, cleaned up for reading. For paywalled
        sites, save from a browser where you&rsquo;re logged in: the page you can see is what gets saved.
      </p>
      {error && <p style={{ ...step, color: "var(--danger-text)" }}>{error}</p>}

      <details style={{ marginTop: 10 }}>
        <summary style={{ fontWeight: 600, fontSize: 14 }}>iPhone: Share sheet Shortcut (recommended)</summary>
        <ol style={{ paddingLeft: 18 }}>
          <li style={step}>
            Shortcuts app → new shortcut → <em>Details</em> → turn on <strong>Show in Share Sheet</strong>, input
            type Safari web pages and URLs.
          </li>
          <li style={step}>
            Add <strong>Run JavaScript on Web Page</strong> with:
            <code style={code}>{SHORTCUT_JS}</code>
            <CopyButton value={SHORTCUT_JS} label="Copy script" />
          </li>
          <li style={step}>
            Add <strong>Get Contents of URL</strong>: URL <code style={code}>{origin}/api/save</code> Method{" "}
            <strong>POST</strong>, header <code>Authorization</code> = <code style={code}>Bearer {token ?? "…"}</code>
            {token && <CopyButton value={`Bearer ${token}`} label="Copy header" />} header <code>Content-Type</code> ={" "}
            <code>application/json</code>, Request Body <strong>File</strong> → <em>JavaScript Result</em>.
          </li>
          <li style={step}>
            Optional: <strong>Show Notification</strong> with the result. From apps other than Safari (X, Substack),
            the JavaScript step is skipped, so send the shared URL as the body instead; the server fetches it.
          </li>
        </ol>
      </details>

      <details style={{ marginTop: 10 }}>
        <summary style={{ fontWeight: 600, fontSize: 14 }}>Computer: bookmarklet</summary>
        <p style={step}>
          Drag this to your bookmarks bar, then click it on any article:{" "}
          <a ref={bookmarkletRef} className="filter-action-btn" onClick={(e) => e.preventDefault()}>
            Save to Cluck&rsquo;s Feed
          </a>
        </p>
        <p style={step}>
          Some sites block bookmarklets with security settings; if nothing opens, use the Share Shortcut or paste the
          link on the <Link href="/save">Save page</Link>.
        </p>
        {bookmarklet && <CopyButton value={bookmarklet} label="Copy bookmarklet code" />}
      </details>

      <details style={{ marginTop: 10 }}>
        <summary style={{ fontWeight: 600, fontSize: 14 }}>Android / paste a link</summary>
        <p style={step}>
          Install the app to your home screen and it appears in the Android share sheet. Or paste any link on the{" "}
          <Link href="/save">Save page</Link>.
        </p>
      </details>

      <p style={{ ...step, color: "var(--muted)", marginTop: 12 }}>
        The token above works like a password for saving. If it leaks,{" "}
        <button
          type="button"
          className="filter-action-btn"
          onClick={() => {
            if (window.confirm("Make a new save token? Your current Shortcut and bookmarklet will stop working.")) load(true);
          }}
        >
          make a new one
        </button>
        .
      </p>
    </section>
  );
}
