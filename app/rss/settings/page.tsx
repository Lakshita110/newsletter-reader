"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type Feed = {
  id: string;
  sourceId: string;
  name: string;
  rssUrl: string;
  isActive: boolean;
  dailyCap: number;
  lastSyncedAt?: string | null;
};

export default function RssSettingsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [name, setName] = useState("");
  const [rssUrl, setRssUrl] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const loadFeeds = async () => {
    const res = await fetch("/api/sources/rss");
    if (!res.ok) return;
    const data = await res.json();
    setFeeds(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    if (!session?.user?.email) return;
    loadFeeds().catch(() => null);
  }, [session?.user?.email]);

  useEffect(() => {
    if (session === null) {
      router.replace("/sign-in");
    }
  }, [session, router]);

  const addFeed = async () => {
    const trimmedUrl = rssUrl.trim();
    if (!trimmedUrl) {
      setNotice("RSS URL is required.");
      return;
    }

    setIsAdding(true);
    setNotice(null);
    try {
      const res = await fetch("/api/sources/rss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), rssUrl: trimmedUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(data?.error || "Could not add feed.");
        return;
      }

      setName("");
      setRssUrl("");
      setNotice("Feed added.");
      await loadFeeds();
    } finally {
      setIsAdding(false);
    }
  };

  const startEdit = (feed: Feed) => {
    setEditingId(feed.id);
    setDraftName(feed.name);
  };

  const saveEdit = async (feedId: string) => {
    const nextName = draftName.trim();
    if (!nextName) {
      setNotice("Name cannot be empty.");
      return;
    }

    setBusyId(feedId);
    setNotice(null);
    try {
      const res = await fetch(`/api/sources/rss/${feedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(data?.error || "Could not update name.");
        return;
      }
      setFeeds((prev) => prev.map((feed) => (feed.id === feedId ? { ...feed, name: nextName } : feed)));
      setEditingId(null);
      setNotice("Feed name updated.");
    } finally {
      setBusyId(null);
    }
  };

  const removeFeed = async (feedId: string) => {
    setBusyId(feedId);
    setNotice(null);
    try {
      const res = await fetch(`/api/sources/rss/${feedId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(data?.error || "Could not remove feed.");
        return;
      }
      setFeeds((prev) => prev.filter((feed) => feed.id !== feedId));
      if (editingId === feedId) setEditingId(null);
      setNotice("Feed removed.");
    } finally {
      setBusyId(null);
    }
  };

  if (!session) {
    return (
      <main style={{ maxWidth: 640, margin: "80px auto", padding: 20 }}>
        <p>Loading...</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 860, margin: "44px auto", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>RSS Feed Settings</h1>
        <Link href="/inbox/rss" style={{ color: "#1d4ed8" }}>
          Back to RSS inbox
        </Link>
      </div>

      <section
        style={{
          border: "1px solid var(--faint)",
          borderRadius: 12,
          background: "#fff",
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Add a feed</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Feed name (optional)"
            style={{ border: "1px solid var(--faint)", borderRadius: 10, padding: "8px 10px" }}
          />
          <input
            value={rssUrl}
            onChange={(e) => setRssUrl(e.target.value)}
            placeholder="https://example.com/feed.xml"
            style={{ border: "1px solid var(--faint)", borderRadius: 10, padding: "8px 10px" }}
          />
          <button
            onClick={addFeed}
            disabled={isAdding}
            style={{
              border: "1px solid #dbeafe",
              borderRadius: 999,
              background: "#f8fbff",
              color: "#1d4ed8",
              padding: "0 14px",
              height: 36,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {isAdding ? "Adding..." : "Add"}
          </button>
        </div>
      </section>

      <section
        style={{
          border: "1px solid var(--faint)",
          borderRadius: 12,
          background: "#fff",
          padding: 14,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Your feeds ({feeds.length})</div>
        {feeds.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>No RSS feeds yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {feeds.map((feed) => {
              const isBusy = busyId === feed.id;
              const isEditing = editingId === feed.id;
              return (
                <div
                  key={feed.id}
                  style={{
                    border: "1px solid var(--faint)",
                    borderRadius: 10,
                    padding: 10,
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center" }}>
                    {isEditing ? (
                      <input
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        style={{ border: "1px solid var(--faint)", borderRadius: 8, padding: "6px 8px" }}
                      />
                    ) : (
                      <div style={{ fontWeight: 600 }}>{feed.name}</div>
                    )}
                    {isEditing ? (
                      <button
                        onClick={() => saveEdit(feed.id)}
                        disabled={isBusy}
                        style={{
                          border: "1px solid #dbeafe",
                          borderRadius: 999,
                          background: "#f8fbff",
                          color: "#1d4ed8",
                          padding: "0 10px",
                          height: 30,
                          cursor: "pointer",
                        }}
                      >
                        Save
                      </button>
                    ) : (
                      <button
                        onClick={() => startEdit(feed)}
                        disabled={isBusy}
                        style={{
                          border: "1px solid var(--faint)",
                          borderRadius: 999,
                          background: "#fff",
                          color: "var(--muted)",
                          padding: "0 10px",
                          height: 30,
                          cursor: "pointer",
                        }}
                      >
                        Rename
                      </button>
                    )}
                    <button
                      onClick={() => removeFeed(feed.id)}
                      disabled={isBusy}
                      style={{
                        border: "1px solid #fecaca",
                        borderRadius: 999,
                        background: "#fff1f2",
                        color: "#b91c1c",
                        padding: "0 10px",
                        height: 30,
                        cursor: "pointer",
                      }}
                    >
                      {isBusy ? "..." : "Remove"}
                    </button>
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>{feed.rssUrl}</div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>
                    {feed.lastSyncedAt
                      ? `Last synced: ${new Date(feed.lastSyncedAt).toLocaleString()}`
                      : "Not synced yet"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {notice && <div style={{ marginTop: 12, color: "var(--muted)", fontSize: 13 }}>{notice}</div>}
    </main>
  );
}
