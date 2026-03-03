"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { getRssCategoryLabel } from "@/lib/rss-categories";

const RSS_SYNC_KEY = "nr_last_rss_sync_at";
const RSS_SYNC_INTERVAL_MS = 60 * 60 * 1000;

function isTypingTarget(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node) return false;
  return node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable;
}

function escapeSelectorValue(value: string): string {
  if (typeof window !== "undefined" && window.CSS?.escape) return window.CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

export default function RssInboxPage() {
  const { data: session } = useSession();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [q, setQ] = useState("");
  const [selectedPub, setSelectedPub] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(() => getRelativeKeys().todayKey);
  const [showAllEarlier, setShowAllEarlier] = useState(false);
  const [overflowBySource, setOverflowBySource] = useState<
    { sourceId: string; sourceName: string; count: number }[]
  >([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSyncingRss, setIsSyncingRss] = useState(false);
  const [rssSyncNotice, setRssSyncNotice] = useState<string | null>(null);
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
  const syncingRef = useRef(false);
  const router = useRouter();
  const selectedSourceId = useMemo(() => {
    if (!selectedPub?.startsWith("rss:")) return null;
    const sourceId = selectedPub.slice(4).trim();
    return sourceId || null;
  }, [selectedPub]);

  const loadRssInbox = useCallback(async () => {
    const params = new URLSearchParams({ kind: "rss" });
    if (selectedSourceId) params.set("sourceId", selectedSourceId);
    const res = await fetch(`/api/feed/inbox?${params.toString()}`);
    const data = await res.json();
    setItems(Array.isArray(data?.items) ? data.items : []);
    setOverflowBySource(Array.isArray(data?.overflowBySource) ? data.overflowBySource : []);
  }, [selectedSourceId]);

  const syncRssFeeds = useCallback(
    async (silent = false) => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      setIsSyncingRss(true);
      if (!silent) setRssSyncNotice(null);
      try {
        const res = await fetch("/api/rss/sync", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!silent) setRssSyncNotice(data?.error || "RSS sync failed.");
          return;
        }
        if (typeof window !== "undefined") {
          window.localStorage.setItem(RSS_SYNC_KEY, String(Date.now()));
        }
        await loadRssInbox();
        if (!silent) {
          setRssSyncNotice(
            `Synced: ${data?.inserted ?? 0} new, ${data?.updated ?? 0} already present.`
          );
        }
      } finally {
        syncingRef.current = false;
        setIsSyncingRss(false);
      }
    },
    [loadRssInbox]
  );

  useEffect(() => {
    (async () => {
      await loadRssInbox().catch(() => null);
    })();
  }, [loadRssInbox]);

  useEffect(() => {
    if (!session?.user?.email) return;

    const maybeSyncNow = async () => {
      let shouldSync = true;
      if (typeof window !== "undefined") {
        const raw = window.localStorage.getItem(RSS_SYNC_KEY);
        const last = raw ? Number(raw) : 0;
        shouldSync = !Number.isFinite(last) || Date.now() - last >= RSS_SYNC_INTERVAL_MS;
      }
      if (shouldSync) {
        await syncRssFeeds(true);
      }
    };

    maybeSyncNow().catch(() => null);
    const timer = window.setInterval(() => {
      syncRssFeeds(true).catch(() => null);
    }, RSS_SYNC_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [session?.user?.email, syncRssFeeds]);

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
  }, [session?.user?.email]);

  useEffect(() => {
    window.localStorage.setItem("nr_read_status_map", JSON.stringify(statusById));
  }, [statusById]);

  const publications = useMemo(() => getPublications(items), [items]);
  const categories = useMemo(() => {
    const map = new Map<string, { key: string; count: number }>();
    for (const item of items) {
      const key = item.category?.trim() || "uncategorized";
      const prev = map.get(key);
      map.set(key, { key, count: (prev?.count ?? 0) + 1 });
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [items]);
  const enriched = useMemo(() => enrichItems(items), [items]);
  const days = useMemo(() => getDays(enriched), [enriched]);
  const categoryFiltered = useMemo(
    () =>
      selectedCategory
        ? enriched.filter((it) => (it.category?.trim() || "uncategorized") === selectedCategory)
        : enriched,
    [enriched, selectedCategory]
  );

  const filtered = useMemo(
    () => filterItems(categoryFiltered, q, selectedPub, selectedDay),
    [categoryFiltered, q, selectedPub, selectedDay]
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
  const contextById = useMemo(() => {
    const next: Record<string, { title: string; sourceKind: "gmail" | "rss"; publicationName: string }> =
      {};
    for (const item of items) {
      next[item.id] = {
        title: item.subject || "(No subject)",
        sourceKind: item.sourceKind ?? "rss",
        publicationName: item.publicationName,
      };
    }
    return next;
  }, [items]);

  const markInProgress = useCallback((id: string) => {
    setStatusById((prev) => {
      if (prev[id] === "read") return prev;
      return { ...prev, [id]: "in-progress" };
    });
    fetch("/api/read-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: id, state: "in_progress", metadata: contextById[id] }),
    }).catch(() => null);
  }, [contextById]);

  const markRead = useCallback((id: string) => {
    setStatusById((prev) => ({ ...prev, [id]: "read" }));
    fetch("/api/read-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: id, state: "read", metadata: contextById[id] }),
    }).catch(() => null);
  }, [contextById]);

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
      body: JSON.stringify({
        messageIds: olderUnreadIds,
        state: "read",
        contextById: olderUnreadIds.reduce<Record<string, (typeof contextById)[string]>>((acc, id) => {
          const context = contextById[id];
          if (context) acc[id] = context;
          return acc;
        }, {}),
      }),
    }).catch(() => null);
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
      if (isTypingTarget(event.target)) return;

      if (ordered.length === 0) return;

      if (event.key === "j" || event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, ordered.length - 1));
      } else if (event.key === "k" || event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (event.key === "o" || event.key === "Enter") {
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
  }, [activeSelectedIndex, markInProgress, markRead, ordered, router]);

  useEffect(() => {
    if (ordered.length === 0) return;
    const current = ordered[activeSelectedIndex];
    if (!current) return;
    const selector = `[data-feed-item-id="${escapeSelectorValue(current.id)}"]`;
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeSelectedIndex, ordered]);

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
    <main style={{ maxWidth: 900, margin: "44px auto", padding: 20 }}>
      <InboxModeTabs mode="rss" />
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

      <Link href="/rss/settings" className="manage-rss-pill">
        Manage RSS feeds
      </Link>
      <button
        type="button"
        className="sync-rss-pill"
        onClick={() => syncRssFeeds(false)}
        disabled={isSyncingRss}
        title="Sync RSS feeds now"
      >
        {isSyncingRss ? "Syncing..." : "Sync feeds"}
      </button>

      <PublicationPills
        selectedPub={selectedPub}
        publications={publications}
        onSelect={setSelectedPub}
      />

      <section style={{ marginBottom: 18 }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            padding: 12,
            background: "var(--surface)",
            border: "1px solid var(--faint)",
            borderRadius: 16,
          }}
        >
          <button
            onClick={() => setSelectedCategory(null)}
            style={{
              cursor: "pointer",
              borderRadius: 999,
              padding: "6px 10px",
              fontSize: 13,
              border: "1px solid var(--faint)",
              background: selectedCategory === null ? "var(--surface-accent)" : "var(--surface)",
              color: selectedCategory === null ? "var(--accent-blue)" : "var(--muted)",
            }}
          >
            All categories
          </button>
          {categories.map((c) => (
            <button
              key={c.key}
              onClick={() => setSelectedCategory(c.key)}
              style={{
                cursor: "pointer",
                borderRadius: 999,
                padding: "6px 10px",
                fontSize: 13,
                border: "1px solid var(--faint)",
                background:
                  selectedCategory === c.key ? "var(--surface-accent)" : "var(--surface)",
                color: selectedCategory === c.key ? "var(--accent-blue)" : "var(--muted)",
              }}
            >
              {c.key === "uncategorized" ? "Uncategorized" : getRssCategoryLabel(c.key)} ({c.count})
            </button>
          ))}
        </div>
      </section>

      <DayPills selectedDay={selectedDay} days={days} onSelect={setSelectedDay} />

      <div style={{ margin: "0 0 18px", color: "var(--muted)", fontSize: 13 }}>
        Keyboard: arrows or j/k (move), Enter/o (open), r (mark read).
      </div>
      {rssSyncNotice && (
        <div style={{ margin: "-8px 0 14px", color: "var(--muted)", fontSize: 12 }}>
          {rssSyncNotice}
        </div>
      )}

      {!selectedDay && dailyEdition.hiddenEarlierCount > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => setShowAllEarlier((prev) => !prev)}
            style={{
              border: "1px solid var(--faint)",
              borderRadius: 999,
              background: "var(--surface)",
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
            background: "var(--surface)",
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
                  border: "1px solid var(--faint)",
                  borderRadius: 999,
                  padding: "4px 8px",
                  color: "var(--link)",
                  background: "var(--surface-accent-soft)",
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
    </main>
  );
}
