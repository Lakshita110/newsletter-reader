"use client";

import { useEffect, useState } from "react";

type Sender = { id: string; email: string; name: string | null };
type Suggestion = { email: string; name: string; count: number; lastSubject: string };

/**
 * The newsletters you actually read. Once this list has anything in it,
 * sync pulls exactly these senders from all of Gmail (archived and labeled
 * mail included) instead of guessing from the inbox.
 */
export default function NewsletterSendersSection() {
  const [senders, setSenders] = useState<Sender[]>([]);
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch("/api/newsletters/senders", { cache: "no-store" });
    if (res.ok) setSenders(await res.json());
  };

  useEffect(() => {
    load().catch(() => setNotice("Could not load newsletter senders."));
  }, []);

  const add = async (emails: string[], name?: string) => {
    setBusy("add");
    setNotice(null);
    try {
      const res = await fetch("/api/newsletters/senders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails, name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(data?.error || "Could not add sender.");
        return;
      }
      setInput("");
      setSuggestions((prev) => prev?.filter((s) => !data.added?.includes(s.email)) ?? null);
      await load();
      setBusy("sync");
      const sync = await fetch("/api/newsletters/sync", { method: "POST" });
      const result = await sync.json().catch(() => ({}));
      setNotice(
        sync.ok
          ? `Pulled in ${result.added ?? 0} issue${result.added === 1 ? "" : "s"}${result.status === "partial" ? " so far (more on next open)" : ""}.`
          : "Saved. Issues will appear next time the inbox loads."
      );
    } finally {
      setBusy(null);
    }
  };

  const remove = async (email: string) => {
    setBusy(email);
    try {
      await fetch(`/api/newsletters/senders?email=${encodeURIComponent(email)}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const suggest = async () => {
    setBusy("suggest");
    setNotice(null);
    try {
      const res = await fetch("/api/newsletters/senders/suggest", { cache: "no-store" });
      const data = await res.json().catch(() => []);
      if (!res.ok) setNotice(data?.error || "Could not scan your mail. Try signing in again.");
      else setSuggestions(data);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section style={{ marginBottom: 18, borderBottom: "1px solid var(--faint)", paddingBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Newsletters you read</div>
        <button type="button" onClick={suggest} disabled={busy !== null} className="filter-action-btn">
          {busy === "suggest" ? "Scanning mail…" : "Find in my mail"}
        </button>
      </div>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 10px" }}>
        {senders.length === 0
          ? "No list yet, so newsletters are guessed from your inbox. Add senders to pull exactly these, even if they're archived or labeled."
          : "Exactly these senders are pulled from all of Gmail, and each issue is kept so it never disappears."}
      </p>

      <form
        className="settings-grid settings-grid-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) add([input]);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="sender@substack.com (comma-separate several)"
          className="settings-input"
          inputMode="email"
          autoCapitalize="off"
        />
        <button type="submit" disabled={busy !== null || !input.trim()} className="filter-action-btn">
          {busy === "add" ? "Adding…" : busy === "sync" ? "Syncing…" : "Add"}
        </button>
      </form>

      {senders.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 6 }}>
          {senders.map((s) => (
            <li key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                {s.name ? <strong style={{ marginRight: 6 }}>{s.name}</strong> : null}
                <span style={{ color: "var(--muted)" }}>{s.email}</span>
              </span>
              <button
                type="button"
                onClick={() => remove(s.email)}
                disabled={busy === s.email}
                className="filter-action-btn"
                aria-label={`Stop pulling ${s.email}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {suggestions && (
        <div style={{ marginTop: 12 }}>
          {suggestions.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              No new newsletter senders found in the last 30 days.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
                Seen in your mail recently (tap to add):
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {suggestions.map((s) => (
                  <button
                    key={s.email}
                    type="button"
                    className="filter-action-btn"
                    disabled={busy !== null}
                    onClick={() => add([s.email], s.name)}
                    title={`${s.email} · last: ${s.lastSubject}`}
                  >
                    + {s.name} <span style={{ opacity: 0.6 }}>({s.count})</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {notice && <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 13 }}>{notice}</div>}
    </section>
  );
}
