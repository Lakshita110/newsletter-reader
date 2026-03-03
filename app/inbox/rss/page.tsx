"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { InboxFilters, type InboxViewMode, toDayOptions } from "../components/FilterPills";
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
  const [viewMode, setViewMode] = useState<InboxViewMode>("today");
  const [selectedPub, setSelectedPub] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
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
  const [savedById, setSavedById] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    const stored = window.localStorage.getItem("nr_saved_items_map");
    if (!stored) return {};
    try {
      const parsed = JSON.parse(stored) as Record<string, boolean>;
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

  useEffect(() => {
    window.localStorage.setItem("nr_saved_items_map", JSON.stringify(savedById));
  }, [savedById]);

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
  const { todayKey } = useMemo(() => getRelativeKeys(), []);
  const isSourceFocused = Boolean(selectedPub);

  const viewFiltered = useMemo(() => {
    return enriched.filter((it) => {
      if (viewMode === "today") return it._dayKey === todayKey;
      if (viewMode === "unread") return statusById[it.id] !== "read";
      if (viewMode === "saved") return savedById[it.id] === true;
      return true;
    });
  }, [enriched, savedById, statusById, todayKey, viewMode]);

  const categoryFiltered = useMemo(() => {
    if (!selectedCategory) return viewFiltered;
    return viewFiltered.filter((it) => (it.category?.trim() || "uncategorized") === selectedCategory);
  }, [selectedCategory, viewFiltered]);

  const filtered = useMemo(
    () => filterItems(categoryFiltered, q, selectedPub, selectedDay),
    [categoryFiltered, q, selectedPub, selectedDay]
  );

  const dailyEdition = useMemo(
    () => buildDailyEdition(filtered, 30, showAllEarlier),
    [filtered, showAllEarlier]
  );
  const grouped = useMemo(
    () => (selectedDay || isSourceFocused ? groupItemsByDay(filtered) : dailyEdition.grouped),
    [dailyEdition.grouped, filtered, isSourceFocused, selectedDay]
  );

  const ordered = useMemo(() => grouped.flatMap((group) => group.items), [grouped]);

  const todayStats = useMemo(() => getTodayStats(enriched, statusById), [enriched, statusById]);
  const activeSelectedIndex =
    ordered.length === 0 ? 0 : Math.min(selectedIndex, ordered.length - 1);
  const olderUnreadIds = useMemo(() => {
    if (selectedDay || isSourceFocused || viewMode !== "all") return [];
    return dailyEdition.olderIds.filter((id) => statusById[id] !== "read");
  }, [dailyEdition.olderIds, isSourceFocused, selectedDay, statusById, viewMode]);
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

  const handlePublicationChange = useCallback((key: string | null) => {
    setSelectedPub(key);
    if (key) {
      setViewMode("all");
      setSelectedDay(null);
      setShowAllEarlier(true);
    }
  }, []);

  const handleDayChange = useCallback((key: string | null) => {
    setSelectedDay(key);
    if (viewMode === "today" && key && key !== todayKey) {
      setViewMode("all");
    }
  }, [todayKey, viewMode]);

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

  const toggleSaved = useCallback((id: string) => {
    setSavedById((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

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
    <main style={{ maxWidth: 768, margin: "44px auto", padding: "0 24px 20px" }}>
      <InboxModeTabs mode="rss" />
      <InboxHeader
        todayCount={todayStats.totalToday}
        mode="rss"
        userEmail={session.user?.email}
        q={q}
        onQueryChange={setQ}
        profileLinks={[{ label: "Manage feeds", href: "/rss/settings" }]}
      />

      <InboxFilters
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        selectedPub={selectedPub}
        selectedCategory={selectedCategory}
        selectedDay={selectedDay}
        publicationOptions={publications.map((p) => ({ key: p.key, label: p.name }))}
        categoryOptions={categories.map((c) => ({
          key: c.key,
          label: c.key === "uncategorized" ? "Uncategorized" : getRssCategoryLabel(c.key),
        }))}
        dayOptions={toDayOptions(days)}
        onPublicationChange={handlePublicationChange}
        onCategoryChange={setSelectedCategory}
        onDayChange={handleDayChange}
        rightAction={
          <button
            type="button"
            onClick={() => syncRssFeeds(false)}
            disabled={isSyncingRss}
            className="filter-action-btn"
            title="Sync RSS feeds now"
            style={{ gap: 6 }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10" />
              <path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14" />
            </svg>
            <span>{isSyncingRss ? "Syncing..." : "Sync feed"}</span>
          </button>
        }
      />

      {rssSyncNotice && (
        <div style={{ margin: "-8px 0 14px", color: "var(--muted)", fontSize: 12 }}>
          {rssSyncNotice}
        </div>
      )}

      {viewMode === "all" && !selectedDay && !isSourceFocused && dailyEdition.hiddenEarlierCount > 0 && (
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

      {overflowBySource.length > 0 && !selectedDay && !isSourceFocused && viewMode === "all" && (
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
        savedById={savedById}
        onOpen={markInProgress}
        onMarkRead={markRead}
        onToggleSaved={toggleSaved}
      />
      {viewMode === "all" && olderUnreadIds.length > 0 && (
        <div style={{ margin: "18px 0 0" }}>
          <button onClick={catchUpOlder} className="btn-pill btn-neutral">
            Catch up older ({olderUnreadIds.length})
          </button>
        </div>
      )}
    </main>
  );
}
