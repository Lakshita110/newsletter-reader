"use client";

import { useEffect, useState } from "react";

type Sender = { id: string; email: string; name: string | null };
type Suggestion = { email: string; name: string; count: number; lastSubject: string };

/**
 * The newsletters she subscribes to. Only these senders and newsletter
 * platforms (Substack etc.) are pulled from her mailboxes; nothing else in
 * her mail is guessed at. "Find my newsletters" offers likely senders to
 * approve with one tap.
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
          ? `Pulled in ${result.added ?? 0} issue${result.added === 1 ? "" : "s"}${result.mailboxes?.some((m: { status: string }) => m.status === "partial") ? " so far (more on next open)" : ""}.`
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
    <section className="settings-card">
      <h2 className="settings-card-title">Newsletters</h2>
      <p className="settings-note">
        Substack, beehiiv and other newsletter platforms come in automatically. Anything else shows up only once you add
        its sender here, so random mail stays out.
      </p>

      <form
        className="settings-inline-form"
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
      <div style={{ marginBottom: 12 }}>
        <button type="button" onClick={suggest} disabled={busy !== null} className="filter-action-btn">
          {busy === "suggest" ? "Looking…" : "Find my newsletters"}
        </button>
      </div>

      {suggestions && (
        <div style={{ marginBottom: 12 }}>
          {suggestions.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              Nothing new found. Every newsletter in your mail is already added.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
                Tap the ones you actually read:
              </div>
              <div className="settings-chips">
                {suggestions.map((s) => (
                  <button
                    key={s.email}
                    type="button"
                    className="settings-chip"
                    disabled={busy !== null}
                    onClick={() => add([s.email], s.name)}
                    title={s.lastSubject ? `${s.email} · last: ${s.lastSubject}` : s.email}
                  >
                    + {s.name || s.email} <span style={{ opacity: 0.6 }}>({s.count})</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {senders.length > 0 && (
        <ul className="settings-list">
          {senders.map((s) => (
            <li key={s.id}>
              <span className="settings-list-name">
                {s.name ? <strong style={{ marginRight: 6 }}>{s.name}</strong> : null}
                <span style={{ color: "var(--muted)" }}>{s.email}</span>
              </span>
              <button
                type="button"
                onClick={() => remove(s.email)}
                disabled={busy === s.email}
                className="settings-link-btn"
                aria-label={`Stop pulling ${s.email}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {notice && <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 13 }}>{notice}</div>}
    </section>
  );
}
