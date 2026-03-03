"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { getRssCategoryLabel, RSS_CATEGORY_OPTIONS } from "@/lib/rss-categories";

type Feed = {
  id: string;
  sourceId: string;
  name: string;
  rssUrl: string;
  category?: string | null;
  isActive: boolean;
  dailyCap: number;
  lastSyncedAt?: string | null;
};

type FeedDraft = {
  name: string;
  rssUrl: string;
  category: string;
};

export default function RssSettingsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [name, setName] = useState("");
  const [rssUrl, setRssUrl] = useState("");
  const [category, setCategory] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FeedDraft>({ name: "", rssUrl: "", category: "other" });
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>("all");

  const selectStyle: React.CSSProperties = {
    border: "1px solid var(--faint)",
    borderRadius: 10,
    padding: "8px 10px",
    background: "var(--surface)",
    color: "var(--text)",
    font: "inherit",
    lineHeight: 1.2,
    fontSize: "13px",
    fontWeight: 600,
  };

  const loadFeeds = async () => {
    const res = await fetch("/api/sources/rss", { cache: "no-store" });
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
    const trimmedName = name.trim();
    if (!trimmedUrl) {
      setNotice("RSS URL is required.");
      return;
    }
    if (!trimmedName) {
      setNotice("Name is required.");
      return;
    }
    if (!category.trim()) {
      setNotice("Category is required.");
      return;
    }

    setIsAdding(true);
    setNotice(null);
    try {
      const res = await fetch("/api/sources/rss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, rssUrl: trimmedUrl, category: category.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(data?.error || "Could not add feed.");
        return;
      }

      setName("");
      setRssUrl("");
      setCategory("");
      setNotice("Feed added.");
      await loadFeeds();
    } finally {
      setIsAdding(false);
    }
  };

  const beginEdit = (feed: Feed) => {
    setEditingId(feed.id);
    setDraft({
      name: feed.name,
      rssUrl: feed.rssUrl,
      category: feed.category ?? "other",
    });
    setNotice(null);
  };

  const saveEdit = async (feedId: string) => {
    const nextName = draft.name.trim();
    const nextUrl = draft.rssUrl.trim();
    const nextCategory = draft.category.trim();
    if (!nextName) {
      setNotice("Name is required.");
      return;
    }
    if (!nextUrl) {
      setNotice("RSS URL is required.");
      return;
    }
    if (!nextCategory) {
      setNotice("Category is required.");
      return;
    }

    setBusyId(feedId);
    setNotice(null);
    try {
      const res = await fetch(`/api/sources/rss/${feedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nextName,
          rssUrl: nextUrl,
          category: nextCategory,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(data?.error || "Could not update feed.");
        return;
      }
      setEditingId(null);
      setNotice("Feed updated.");
      await loadFeeds();
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
      setNotice("Feed removed.");
    } finally {
      setBusyId(null);
    }
  };

  const filteredFeeds = feeds.filter((feed) => {
    if (selectedCategoryFilter === "all") return true;
    return (feed.category ?? "other") === selectedCategoryFilter;
  });

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
        <Link href="/inbox/rss" className="back-link-muted">
          Back to RSS inbox
        </Link>
      </div>

      <section
        style={{
          border: "1px solid var(--faint)",
          borderRadius: 12,
          background: "var(--surface)",
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Add a feed</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr auto", gap: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Feed name"
            style={{
              border: "1px solid var(--faint)",
              borderRadius: 10,
              padding: "8px 10px",
              background: "var(--surface)",
              color: "var(--text)",
            }}
          />
          <input
            value={rssUrl}
            onChange={(e) => setRssUrl(e.target.value)}
            placeholder="https://example.com/feed.xml"
            style={{
              border: "1px solid var(--faint)",
              borderRadius: 10,
              padding: "8px 10px",
              background: "var(--surface)",
              color: "var(--text)",
            }}
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={selectStyle}
          >
            <option value="">Category</option>
            {RSS_CATEGORY_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {getRssCategoryLabel(opt)}
              </option>
            ))}
          </select>
          <button
            onClick={addFeed}
            disabled={isAdding}
            className="btn-pill btn-pastel-lav"
          >
            {isAdding ? "Adding..." : "Add"}
          </button>
        </div>
      </section>

      <section
        style={{
          border: "1px solid var(--faint)",
          borderRadius: 12,
          background: "var(--surface)",
          padding: "10px 14px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            marginBottom: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>Your feeds ({filteredFeeds.length})</div>
          <select
            value={selectedCategoryFilter}
            onChange={(e) => setSelectedCategoryFilter(e.target.value)}
            style={{ ...selectStyle, borderRadius: 999, padding: "6px 10px", minWidth: 170 }}
            aria-label="Filter feeds by category"
          >
            <option value="all">All categories</option>
            {RSS_CATEGORY_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {getRssCategoryLabel(opt)}
              </option>
            ))}
          </select>
        </div>
        {filteredFeeds.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>No RSS feeds yet.</div>
        ) : (
          <div>
            {filteredFeeds.map((feed, index) => {
              const isBusy = busyId === feed.id;
              const isEditing = editingId === feed.id;
              return (
                <div
                  key={feed.id}
                  style={{
                    borderBottom:
                      index < filteredFeeds.length - 1 ? "1px solid var(--faint)" : "none",
                    padding: "12px 0",
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) auto",
                      gap: 10,
                      alignItems: "start",
                    }}
                  >
                    {isEditing ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <input
                          value={draft.name}
                          onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                          placeholder="Feed name"
                          style={{
                            border: "1px solid var(--faint)",
                            borderRadius: 8,
                            padding: "6px 8px",
                            background: "var(--surface)",
                            color: "var(--text)",
                          }}
                        />
                        <input
                          value={draft.rssUrl}
                          onChange={(e) => setDraft((prev) => ({ ...prev, rssUrl: e.target.value }))}
                          placeholder="https://example.com/feed.xml"
                          style={{
                            border: "1px solid var(--faint)",
                            borderRadius: 8,
                            padding: "6px 8px",
                            background: "var(--surface)",
                            color: "var(--text)",
                          }}
                        />
                        <select
                          value={draft.category}
                          onChange={(e) => setDraft((prev) => ({ ...prev, category: e.target.value }))}
                          style={{ ...selectStyle, borderRadius: 8, padding: "6px 8px" }}
                        >
                          {RSS_CATEGORY_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {getRssCategoryLabel(opt)}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontWeight: 600 }}>{feed.name}</div>
                        <div style={{ color: "var(--muted)", fontSize: 13 }}>{feed.rssUrl}</div>
                        <div style={{ marginTop: 2 }}>
                          <span className="category-badge">
                            {getRssCategoryLabel(feed.category ?? "other")}
                          </span>
                        </div>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => saveEdit(feed.id)}
                            disabled={isBusy}
                            className="btn-pill-sm btn-pastel-sky"
                          >
                            {isBusy ? "Saving..." : "Save"}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            disabled={isBusy}
                            className="btn-pill-sm btn-neutral"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => beginEdit(feed)}
                          disabled={isBusy}
                          className="btn-pill-sm btn-neutral"
                        >
                          Edit
                        </button>
                      )}
                      <button
                        onClick={() => removeFeed(feed.id)}
                        disabled={isBusy}
                        aria-label={`Remove ${feed.name}`}
                        title={`Remove ${feed.name}`}
                        className="btn-pill-sm btn-danger"
                      >
                        {isBusy ? (
                          "..."
                        ) : (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M3 6h18" />
                            <path d="M8 6V4h8v2" />
                            <path d="M19 6l-1 14H6L5 6" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
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
