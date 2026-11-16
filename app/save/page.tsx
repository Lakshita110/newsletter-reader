"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";

/** Share sheets often put the link inside "text" ("Check this out https://…"). */
function pickUrl(...candidates: (string | null)[]): string | null {
  for (const value of candidates) {
    const match = value?.match(/https?:\/\/\S+/);
    if (match) return match[0].replace(/[)\].,]+$/, "");
  }
  return null;
}

type State = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; title: string; id: string } | { kind: "error"; message: string };

function SaveInner() {
  const params = useSearchParams();
  const { status } = useSession();
  const [url, setUrl] = useState(() => pickUrl(params.get("url"), params.get("text"), params.get("title")) ?? "");
  const [state, setState] = useState<State>({ kind: "idle" });
  const autoSaved = useRef(false);

  const save = async (target: string) => {
    setState({ kind: "saving" });
    const res = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: target, title: params.get("title") }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setState({ kind: "saved", title: data.title, id: data.id });
    else setState({ kind: "error", message: data?.error || `Save failed (${res.status})` });
  };

  // Arriving from a share sheet: save straight away, no extra tap.
  useEffect(() => {
    if (status !== "authenticated" || autoSaved.current || !url) return;
    autoSaved.current = true;
    save(url).catch((error) => setState({ kind: "error", message: String(error) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <main className="today-shell">
      <h1 className="today-title">Save a link</h1>
      <p className="today-subtitle">Saved links go to your Saved list, cleaned up for reading.</p>
      <form
        className="settings-grid settings-grid-2"
        style={{ marginTop: 18 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) save(url.trim());
        }}
      >
        <input
          className="settings-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          inputMode="url"
          autoCapitalize="off"
        />
        <button className="filter-action-btn" type="submit" disabled={state.kind === "saving" || !url.trim()}>
          {state.kind === "saving" ? "Saving…" : "Save"}
        </button>
      </form>
      {state.kind === "saved" && (
        <p style={{ marginTop: 16 }}>
          ✓ Saved <strong>{state.title}</strong>.{" "}
          <Link href={`/read/${encodeURIComponent(state.id)}`}>Read now</Link> ·{" "}
          <Link href="/today?tab=saved">Open Saved</Link>
        </p>
      )}
      {state.kind === "error" && (
        <p style={{ marginTop: 16, color: "var(--danger-text)" }}>
          {state.message}. If it&rsquo;s a paywalled page, save it with the Shortcut or bookmarklet from a browser
          where you&rsquo;re logged in (see Sources).
        </p>
      )}
      {status === "unauthenticated" && (
        <p style={{ marginTop: 16 }}>
          <Link href="/sign-in">Sign in</Link> to save.
        </p>
      )}
    </main>
  );
}

export default function SavePage() {
  return (
    <Suspense>
      <SaveInner />
    </Suspense>
  );
}
