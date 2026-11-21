"use client";

import { useEffect, useState } from "react";
import { STARTER_FEEDS } from "./starter-feeds";

type Feed = {
  id: string;
  name: string;
  rssUrl: string;
  consecutiveFailures?: number;
  lastErrorMessage?: string | null;
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/**
 * RSS sources, kept to three actions: add (paste anything: a feed, a website,
 * a Substack name), remove, and bring a whole list over from another reader.
 * Names come from the feed itself, so there's nothing to fill in.
 */
export default function FeedsSection() {
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () =>
    fetch("/api/sources/rss", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`feeds ${res.status}`))))
      .then((data: Feed[]) => setFeeds(data))
      .catch((err: unknown) => {
        console.error("[settings] load feeds failed", err);
        setNotice("Couldn't load your feeds.");
      });

  useEffect(() => {
    load();
  }, []);

  const add = async (url: string) => {
    setBusy(url);
    setNotice(null);
    try {
      const res = await fetch("/api/sources/rss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rssUrl: url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(data?.error || "Couldn't add that feed.");
        return;
      }
      if (url === input) setInput("");
      setNotice(`Added ${data.name ?? "feed"}.`);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (feed: Feed) => {
    setBusy(feed.id);
    try {
      const res = await fetch(`/api/sources/rss/${feed.id}`, { method: "DELETE" });
      if (!res.ok) setNotice(`Couldn't remove ${feed.name}.`);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const importOpml = async (file: File) => {
    setBusy("import");
    setNotice(null);
    try {
      const res = await fetch("/api/sources/rss/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opml: await file.text() }),
      });
      const data = await res.json().catch(() => ({}));
      setNotice(
        res.ok
          ? `Imported ${data.imported} feeds${data.failed ? ` (${data.failed} couldn't be read yet)` : ""}.`
          : data?.error || "Import failed."
      );
      await load();
    } finally {
      setBusy(null);
    }
  };

  const have = new Set((feeds ?? []).map((f) => f.rssUrl.replace(/\/$/, "")));
  const starters = STARTER_FEEDS.filter((s) => !have.has(s.url.replace(/\/$/, "")));

  return (
    <section className="settings-card">
      <h2 className="settings-card-title">Feeds</h2>
      <form
        className="settings-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) add(input.trim());
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste a site, feed, or Substack name"
          className="settings-input"
          aria-label="Feed to add"
        />
        <button type="submit" className="filter-action-btn" disabled={!input.trim() || busy !== null}>
          {busy === input.trim() && input ? "Adding…" : "Add"}
        </button>
      </form>
      {notice && <p className="settings-note">{notice}</p>}

      {starters.length > 0 && (
        <div className="settings-chips" aria-label="Suggested feeds">
          {starters.map((s) => (
            <button
              key={s.url}
              type="button"
              className="settings-chip"
              title={s.why}
              disabled={busy !== null}
              onClick={() => add(s.url)}
            >
              {busy === s.url ? "Adding…" : `+ ${s.name}`}
            </button>
          ))}
        </div>
      )}

      <ul className="settings-list">
        {feeds?.map((feed) => (
          <li key={feed.id}>
            {/* eslint-disable-next-line @next/next/no-img-element -- tiny remote icon */}
            <img
              src={`https://icons.duckduckgo.com/ip3/${hostOf(feed.rssUrl)}.ico`}
              alt=""
              width={16}
              height={16}
              className="settings-list-icon"
              referrerPolicy="no-referrer"
              onError={(e) => (e.currentTarget.style.visibility = "hidden")}
            />
            <span className="settings-list-name">
              {feed.name}
              {(feed.consecutiveFailures ?? 0) >= 3 && (
                <span className="settings-warn" title={feed.lastErrorMessage ?? undefined}>
                  not updating
                </span>
              )}
            </span>
            <button type="button" className="settings-link-btn" disabled={busy !== null} onClick={() => remove(feed)}>
              Remove
            </button>
          </li>
        ))}
      </ul>

      <label className="settings-link-btn" style={{ display: "inline-block", marginTop: 10, cursor: "pointer" }}>
        {busy === "import" ? "Importing…" : "Import from another reader (OPML)"}
        <input
          type="file"
          accept=".opml,.xml,text/xml"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importOpml(file);
            e.target.value = "";
          }}
        />
      </label>
    </section>
  );
}
