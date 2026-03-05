"use client";

import { useEffect, useMemo, useState } from "react";
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
  lastSyncedAt?: string | null;
};

type FeedDraft = {
  name: string;
  rssUrl: string;
  category: string;
};

function categoryToneClass(value: string | null | undefined): string {
  const key = (value ?? "other").toLowerCase();
  return `category-tone-${key}`;
}

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

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const feed of feeds) {
      const key = (feed.category ?? "other").toLowerCase();
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [feeds]);

  if (!session) {
    return (
      <main style={{ maxWidth: 640, margin: "80px auto", padding: 20 }}>
        <p>Loading...</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 768, margin: "44px auto", padding: "0 24px 20px" }}>
      <header style={{ borderBottom: "1px solid var(--faint)", paddingBottom: 12, marginBottom: 18 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1 className="app-page-title settings-title">RSS Feed Settings</h1>
            <p className="app-page-subtitle settings-subtitle">
              Manage your sources, categories, and sync readiness.
            </p>
          </div>
          <Link href="/inbox/rss" className="back-link-muted">
            Back to RSS inbox
          </Link>
        </div>
      </header>

      <section style={{ marginBottom: 18, borderBottom: "1px solid var(--faint)", paddingBottom: 16 }}>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>Add feed</div>
        <div className="settings-grid">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Feed name"
            className="settings-input"
          />
          <input
            value={rssUrl}
            onChange={(e) => setRssUrl(e.target.value)}
            placeholder="https://example.com/feed.xml"
            className="settings-input"
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="filter-select">
            <option value="">Category</option>
            {RSS_CATEGORY_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {getRssCategoryLabel(opt)}
              </option>
            ))}
          </select>
          <button onClick={addFeed} disabled={isAdding} className="filter-action-btn">
            {isAdding ? "Adding..." : "Add feed"}
          </button>
        </div>
      </section>

      <section>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            marginBottom: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Your feeds</div>
            <div className="settings-count">{filteredFeeds.length}</div>
          </div>
          <select
            value={selectedCategoryFilter}
            onChange={(e) => setSelectedCategoryFilter(e.target.value)}
            className="filter-select"
            aria-label="Filter feeds by category"
          >
            <option value="all">All categories</option>
            {RSS_CATEGORY_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {getRssCategoryLabel(opt)} ({categoryCounts.get(opt) ?? 0})
              </option>
            ))}
          </select>
        </div>

        {filteredFeeds.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 14 }}>No RSS feeds yet.</div>
        ) : (
          <div>
            {filteredFeeds.map((feed, index) => {
              const isBusy = busyId === feed.id;
              const isEditing = editingId === feed.id;
              const itemCategory = feed.category ?? "other";

              return (
                <div
                  key={feed.id}
                  className={`settings-feed-row ${categoryToneClass(itemCategory)}`}
                  style={{ borderBottom: index < filteredFeeds.length - 1 ? "1px solid var(--faint)" : "none" }}
                >
                  <div className="settings-feed-main">
                    {isEditing ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <input
                          value={draft.name}
                          onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                          placeholder="Feed name"
                          className="settings-input"
                        />
                        <input
                          value={draft.rssUrl}
                          onChange={(e) => setDraft((prev) => ({ ...prev, rssUrl: e.target.value }))}
                          placeholder="https://example.com/feed.xml"
                          className="settings-input"
                        />
                        <select
                          value={draft.category}
                          onChange={(e) => setDraft((prev) => ({ ...prev, category: e.target.value }))}
                          className="filter-select"
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
                        <div className="settings-feed-title">
                          <Link href={`/source/${feed.sourceId}`} style={{ color: "inherit" }}>
                            {feed.name}
                          </Link>
                        </div>
                        <div className="settings-feed-url">{feed.rssUrl}</div>
                        <div style={{ marginTop: 4 }}>
                          <span className={`category-badge ${categoryToneClass(itemCategory)}`}>
                            {getRssCategoryLabel(itemCategory)}
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="settings-feed-actions">
                      {isEditing ? (
                        <>
                          <button onClick={() => saveEdit(feed.id)} disabled={isBusy} className="filter-action-btn">
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
                        <button onClick={() => beginEdit(feed)} disabled={isBusy} className="btn-pill-sm btn-neutral">
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
                  <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 5 }}>
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

      {notice && <div style={{ marginTop: 14, color: "var(--muted)", fontSize: 13 }}>{notice}</div>}
    </main>
  );
}
