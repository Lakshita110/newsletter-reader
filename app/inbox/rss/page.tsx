"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { DayPills, PublicationPills } from "../components/FilterPills";
import { FeedList } from "../components/FeedList";
import { InboxHeader } from "../components/InboxHeader";
import { InboxModeTabs } from "../components/InboxModeTabs";
import {
  buildDailyEdition,
  enrichItems,
  filterItems,
  getDays,
  getPublications,
  getTodayStats,
  groupItemsByDay,
} from "../lib/derive";
import { getRelativeKeys } from "../lib/date";
import type { FeedReadStatus, InboxItem } from "../types";

export default function RssInboxPage() {
  const { data: session } = useSession();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [q, setQ] = useState("");
  const [selectedPub, setSelectedPub] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(() => getRelativeKeys().todayKey);
  const [showAllEarlier, setShowAllEarlier] = useState(false);
  const [rssName, setRssName] = useState("");
  const [rssUrl, setRssUrl] = useState("");
  const [isAddingRss, setIsAddingRss] = useState(false);
  const [isSyncingRss, setIsSyncingRss] = useState(false);
  const [rssNotice, setRssNotice] = useState<string | null>(null);
  const [rssFeeds, setRssFeeds] = useState<
    {
      id: string;
      sourceId: string;
      name: string;
      rssUrl: string;
      isActive: boolean;
      dailyCap: number;
      lastSyncedAt?: string | null;
    }[]
  >([]);
  const [overflowBySource, setOverflowBySource] = useState<
    { sourceId: string; sourceName: string; count: number }[]
  >([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statusById, setStatusById] = useState<Record<string, FeedReadStatus>>(() => {
    if (typeof window === "undefined") return {};
    const stored = window.localStorage.getItem("nr_read_status_map");
    if (!stored) return {};
    try {
      const parsed = JSON.parse(stored) as Record<string, FeedReadStatus>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
  const router = useRouter();
  const rssPrimaryPill: React.CSSProperties = {
    border: "1px solid #dbeafe",
    borderRadius: 999,
    height: 36,
    padding: "0 12px",
    background: "#f8fbff",
    color: "#1d4ed8",
    fontWeight: 600,
    fontSize: 13,
    lineHeight: 1,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  };
  const rssNeutralPill: React.CSSProperties = {
    ...rssPrimaryPill,
    border: "1px solid var(--faint)",
    background: "#fff",
    color: "var(--muted)",
    fontWeight: 500,
  };

  const loadRssFeeds = async () => {
    const res = await fetch("/api/sources/rss");
    if (!res.ok) return;
    const data = await res.json();
    setRssFeeds(Array.isArray(data) ? data : []);
  };

  const loadRssInbox = async () => {
    const res = await fetch("/api/feed/inbox?kind=rss");
    const data = await res.json();
    setItems(Array.isArray(data?.items) ? data.items : []);
    setOverflowBySource(Array.isArray(data?.overflowBySource) ? data.overflowBySource : []);
  };

  useEffect(() => {
    loadRssInbox().catch(() => null);
  }, []);

  useEffect(() => {
    if (!session?.user?.email) return;
    (async () => {
      const res = await fetch("/api/read-state");
      if (!res.ok) return;
      const data = await res.json();
      const next: Record<string, FeedReadStatus> = {};
      const readIds = Array.isArray(data?.readIds) ? data.readIds : [];
      const inProgressIds = Array.isArray(data?.inProgressIds) ? data.inProgressIds : [];
      for (const id of inProgressIds) {
        if (typeof id === "string") next[id] = "in-progress";
      }
      for (const id of readIds) {
        if (typeof id === "string") next[id] = "read";
      }
      setStatusById(next);
    })();
    loadRssFeeds().catch(() => null);
  }, [session?.user?.email]);

  useEffect(() => {
    window.localStorage.setItem("nr_read_status_map", JSON.stringify(statusById));
  }, [statusById]);

  const publications = useMemo(() => getPublications(items), [items]);
  const enriched = useMemo(() => enrichItems(items), [items]);
  const days = useMemo(() => getDays(enriched), [enriched]);

  const filtered = useMemo(
    () => filterItems(enriched, q, selectedPub, selectedDay),
    [enriched, q, selectedPub, selectedDay]
  );

  const dailyEdition = useMemo(
    () => buildDailyEdition(filtered, 30, showAllEarlier),
    [filtered, showAllEarlier]
  );
  const grouped = useMemo(
    () => (selectedDay ? groupItemsByDay(filtered) : dailyEdition.grouped),
    [dailyEdition.grouped, filtered, selectedDay]
  );

  const ordered = useMemo(() => grouped.flatMap((group) => group.items), [grouped]);

  const todayStats = useMemo(() => getTodayStats(enriched, statusById), [enriched, statusById]);
  const activeSelectedIndex =
    ordered.length === 0 ? 0 : Math.min(selectedIndex, ordered.length - 1);
  const olderUnreadIds = useMemo(() => {
    if (selectedDay) return [];
    return dailyEdition.olderIds.filter((id) => statusById[id] !== "read");
  }, [dailyEdition.olderIds, selectedDay, statusById]);

  const markInProgress = (id: string) => {
    setStatusById((prev) => {
      if (prev[id] === "read") return prev;
      return { ...prev, [id]: "in-progress" };
    });
    fetch("/api/read-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: id, state: "in_progress" }),
    }).catch(() => null);
  };

  const markRead = (id: string) => {
    setStatusById((prev) => ({ ...prev, [id]: "read" }));
    fetch("/api/read-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: id, state: "read" }),
    }).catch(() => null);
  };

  const catchUpOlder = () => {
    if (olderUnreadIds.length === 0) return;

    setStatusById((prev) => {
      const next = { ...prev };
      for (const id of olderUnreadIds) next[id] = "read";
      return next;
    });

    fetch("/api/read-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageIds: olderUnreadIds, state: "read" }),
    }).catch(() => null);
  };

  const addRssFeed = async () => {
    const trimmedUrl = rssUrl.trim();
    if (!trimmedUrl) {
      setRssNotice("RSS URL is required.");
      return;
    }
    setIsAddingRss(true);
    setRssNotice(null);
    try {
      const res = await fetch("/api/sources/rss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: rssName.trim(), rssUrl: trimmedUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRssNotice(data?.error || "Could not add RSS feed.");
        return;
      }
      setRssName("");
      setRssUrl("");
      setRssNotice("Feed added.");
      await loadRssFeeds();
      await fetch("/api/rss/sync", { method: "POST" }).catch(() => null);
      await loadRssInbox();
    } finally {
      setIsAddingRss(false);
    }
  };

  const syncRssFeeds = async () => {
    setIsSyncingRss(true);
    setRssNotice(null);
    try {
      const res = await fetch("/api/rss/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRssNotice(data?.error || "RSS sync failed.");
        return;
      }
      setRssNotice(
        `RSS sync done: ${data?.inserted ?? 0} inserted, ${data?.updated ?? 0} updated.`
      );
      await loadRssFeeds();
      await loadRssInbox();
    } finally {
      setIsSyncingRss(false);
    }
  };

  useEffect(() => {
    window.localStorage.setItem(
      "nr_ordered_items",
      JSON.stringify(
        ordered.map((it) => ({
          id: it.id,
          subject: it.subject || "(No subject)",
        }))
      )
    );
  }, [ordered]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }

      if (ordered.length === 0) return;

      if (event.key === "j") {
        event.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, ordered.length - 1));
      } else if (event.key === "k") {
        event.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (event.key === "o") {
        event.preventDefault();
        const current = ordered[activeSelectedIndex];
        if (current) {
          markInProgress(current.id);
          router.push(`/read/${current.id}`);
        }
      } else if (event.key === "r") {
        event.preventDefault();
        const current = ordered[activeSelectedIndex];
        if (!current) return;
        markRead(current.id);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSelectedIndex, ordered, router]);

  useEffect(() => {
    if (session === null) {
      router.replace("/sign-in");
    }
  }, [session, router]);

  if (!session) {
    return (
      <main style={{ maxWidth: 560, margin: "80px auto", padding: 20 }}>
        <p>Loading...</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1120, margin: "44px auto", padding: 20 }}>
      <InboxModeTabs mode="rss" />
      <div className="inbox-layout">
        <div>
          <InboxHeader
            shownCount={ordered.length}
            todayStats={todayStats}
            userEmail={session.user?.email}
            q={q}
            onQueryChange={setQ}
            hasSelectedPublication={Boolean(selectedPub)}
            onClearPublication={() => setSelectedPub(null)}
            olderUnreadCount={olderUnreadIds.length}
            onCatchUpOlder={catchUpOlder}
          />

          <PublicationPills
            selectedPub={selectedPub}
            publications={publications}
            onSelect={setSelectedPub}
          />

          <DayPills selectedDay={selectedDay} days={days} onSelect={setSelectedDay} />

          <div style={{ margin: "0 0 18px", color: "var(--muted)", fontSize: 13 }}>
            RSS inbox with thumbnails. Keyboard: j/k/o/r.
          </div>

          {!selectedDay && dailyEdition.hiddenEarlierCount > 0 && (
            <div style={{ marginBottom: 12 }}>
              <button
                onClick={() => setShowAllEarlier((prev) => !prev)}
                style={{
                  border: "1px solid var(--faint)",
                  borderRadius: 999,
                  background: "#fff",
                  color: "var(--muted)",
                  padding: "6px 10px",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {showAllEarlier
                  ? "Show fewer earlier"
                  : `Show ${dailyEdition.hiddenEarlierCount} more earlier`}
              </button>
            </div>
          )}

          {overflowBySource.length > 0 && !selectedDay && (
            <div
              style={{
                margin: "4px 0 16px",
                padding: "10px 12px",
                border: "1px solid var(--faint)",
                borderRadius: 10,
                background: "#fff",
                color: "var(--muted)",
                fontSize: 13,
              }}
            >
              <div style={{ marginBottom: 6 }}>More available by source:</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {overflowBySource.slice(0, 8).map((x) => (
                  <Link
                    key={x.sourceId}
                    href={`/source/${x.sourceId}`}
                    style={{
                      border: "1px solid #dbeafe",
                      borderRadius: 999,
                      padding: "4px 8px",
                      color: "#1d4ed8",
                      background: "#f8fbff",
                    }}
                  >
                    {x.count} more from {x.sourceName}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <FeedList
            grouped={grouped}
            ordered={ordered}
            selectedIndex={activeSelectedIndex}
            statusById={statusById}
            onOpen={markInProgress}
            onMarkRead={markRead}
          />
        </div>

        <aside
          style={{
            border: "1px solid var(--faint)",
            borderRadius: 12,
            padding: 12,
            background: "#fff",
            height: "fit-content",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>RSS feeds</div>
          <div style={{ display: "grid", gap: 8 }}>
            <input
              value={rssName}
              onChange={(e) => setRssName(e.target.value)}
              placeholder="Feed name (optional)"
              style={{
                border: "1px solid var(--faint)",
                borderRadius: 10,
                padding: "8px 10px",
                background: "#fff",
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
                background: "#fff",
              }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={addRssFeed}
                disabled={isAddingRss}
                style={rssPrimaryPill}
              >
                {isAddingRss ? "Adding..." : "Add feed"}
              </button>
              <button
                onClick={syncRssFeeds}
                disabled={isSyncingRss}
                style={rssNeutralPill}
              >
                {isSyncingRss ? "Syncing..." : "Sync RSS"}
              </button>
            </div>
          </div>

          {rssNotice && (
            <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 12 }}>{rssNotice}</div>
          )}

          <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
            {rssFeeds.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: 13 }}>No RSS feeds yet.</div>
            ) : (
              rssFeeds.map((feed) => (
                <Link
                  key={feed.id}
                  href={`/source/${feed.sourceId}`}
                  style={{
                    display: "block",
                    border: "1px solid var(--faint)",
                    borderRadius: 10,
                    padding: "8px 10px",
                    background: "#fff",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{feed.name}</div>
                  <div style={{ marginTop: 2, color: "var(--muted)", fontSize: 12 }}>
                    daily cap {feed.dailyCap}
                  </div>
                  <div style={{ marginTop: 2, color: "var(--muted)", fontSize: 12 }}>
                    {feed.lastSyncedAt
                      ? `synced ${new Date(feed.lastSyncedAt).toLocaleString()}`
                      : "not synced yet"}
                  </div>
                </Link>
              ))
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
