"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { InboxFilters, type InboxViewMode, toDayOptions } from "../components/FilterPills";
import { FeedList } from "../components/FeedList";
import { CatchUpOlderButton, OverflowSources, ShowEarlierButton } from "../components/FeedControls";
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
import { getRssCategoryLabel } from "@/lib/rss-categories";
import { getRelativeKeys } from "../lib/date";
import { readMapFromStorage, saveMapToStorage, toReadStatusMap, toSavedMap } from "../lib/client-utils";
import { buildContextById, postReadState } from "../lib/read-state";
import { useFeedKeyboardNavigation } from "../hooks/useFeedKeyboardNavigation";
import type { FeedReadStatus, InboxItem } from "../types";

function mapSearchRows(rows: unknown[]): InboxItem[] {
  return rows
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .map((row): InboxItem => {
      const sourceId = typeof row.sourceId === "string" ? row.sourceId : "";
      const sourceName =
        typeof row.sourceName === "string" && row.sourceName.trim() ? row.sourceName : "Unknown source";
      const publishedAt = typeof row.publishedAt === "string" && row.publishedAt ? row.publishedAt : null;
      const category =
        typeof row.category === "string" && row.category.trim() ? row.category.trim() : "other";
      return {
        id: typeof row.id === "string" ? row.id : "",
        sourceId: sourceId || undefined,
        sourceKind: "rss",
        subject: typeof row.title === "string" ? row.title : "(No subject)",
        from: sourceName,
        date: publishedAt ?? new Date(0).toISOString(),
        snippet: (typeof row.excerpt === "string" ? row.excerpt : "").replace(/<\/?mark>/g, ""),
        publicationName: sourceName,
        publicationKey: sourceId ? `rss:${sourceId}` : sourceName.toLowerCase(),
        category,
        externalUrl: typeof row.link === "string" ? row.link : undefined,
      };
    })
    .filter((row) => row.id.startsWith("rss:"));
}

export default function RssInboxPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const syncingRef = useRef(false);

  const [items, setItems] = useState<InboxItem[]>([]);
  const [searchItems, setSearchItems] = useState<InboxItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [viewMode, setViewMode] = useState<InboxViewMode>("recommended");
  const [selectedPub, setSelectedPub] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showAllEarlier, setShowAllEarlier] = useState(false);
  const [overflowBySource, setOverflowBySource] = useState<
    { sourceId: string; sourceName: string; count: number }[]
  >([]);
  const [recommendedIds, setRecommendedIds] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSyncingRss, setIsSyncingRss] = useState(false);
  const [rssSyncNotice, setRssSyncNotice] = useState<string | null>(null);
  const [manualSyncedIds, setManualSyncedIds] = useState<string[]>([]);
  const [statusById, setStatusById] = useState<Record<string, FeedReadStatus>>(() =>
    readMapFromStorage<FeedReadStatus>("nr_read_status_map")
  );
  const [savedById, setSavedById] = useState<Record<string, boolean>>(() =>
    readMapFromStorage<boolean>("nr_saved_items_map")
  );

  const selectedSourceId = useMemo(() => {
    if (!selectedPub?.startsWith("rss:")) return null;
    const sourceId = selectedPub.slice(4).trim();
    return sourceId || null;
  }, [selectedPub]);
  const searchQuery = q.trim();
  const isServerSearchActive = searchQuery.length > 0;

  const loadRssInbox = useCallback(async (opts?: { forceRecommendedPool?: boolean }) => {
    const params = new URLSearchParams({ kind: "rss" });
    const sourceFilterForApi = opts?.forceRecommendedPool
      ? null
      : viewMode === "recommended"
        ? null
        : selectedSourceId;
    if (sourceFilterForApi) params.set("sourceId", sourceFilterForApi);
    const res = await fetch(`/api/feed/inbox?${params.toString()}`);
    const data = await res.json();
    const nextItems = Array.isArray(data?.items) ? data.items : [];
    setItems(nextItems);
    setOverflowBySource(Array.isArray(data?.overflowBySource) ? data.overflowBySource : []);
    setRecommendedIds(
      Array.isArray(data?.rssMeta?.recommendedIds)
        ? data.rssMeta.recommendedIds.filter((id: unknown): id is string => typeof id === "string")
        : []
    );
    return nextItems as InboxItem[];
  }, [selectedSourceId, viewMode]);

  const syncRssFeeds = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setIsSyncingRss(true);
    setRssSyncNotice(null);
    try {
      const res = await fetch("/api/rss/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRssSyncNotice(data?.error || "RSS sync failed.");
        return;
      }
      const newItemIds = Array.isArray(data?.newItemIds)
        ? data.newItemIds.filter((id: unknown): id is string => typeof id === "string")
        : [];
      setManualSyncedIds(newItemIds);
      await loadRssInbox({ forceRecommendedPool: true });
      setRssSyncNotice(`Synced: ${data?.inserted ?? 0} new, ${data?.updated ?? 0} already present.`);
    } finally {
      syncingRef.current = false;
      setIsSyncingRss(false);
    }
  }, [loadRssInbox]);

  useEffect(() => {
    loadRssInbox().catch(() => null);
  }, [loadRssInbox]);

  useEffect(() => {
    if (!isServerSearchActive) {
      setSearchItems([]);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);
      try {
        const params = new URLSearchParams({ q: searchQuery });
        if (selectedSourceId) params.set("sourceId", selectedSourceId);
        const res = await fetch(`/api/search?${params.toString()}`, { signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Search failed.");
        setSearchItems(mapSearchRows(Array.isArray(data?.items) ? data.items : []));
      } catch {
        if (controller.signal.aborted) return;
        setSearchItems([]);
        setSearchError("Search failed. Try again.");
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [isServerSearchActive, searchQuery, selectedSourceId]);

  useEffect(() => {
    if (!session?.user?.email) return;
    (async () => {
      const res = await fetch("/api/read-state");
      if (!res.ok) return;
      const payload = await res.json();
      setStatusById(toReadStatusMap(payload));
      setSavedById(toSavedMap(payload));
    })();
  }, [session?.user?.email]);

  useEffect(() => {
    saveMapToStorage("nr_read_status_map", statusById);
  }, [statusById]);

  useEffect(() => {
    saveMapToStorage("nr_saved_items_map", savedById);
  }, [savedById]);

  const activeItems = useMemo(() => (isServerSearchActive ? searchItems : items), [isServerSearchActive, items, searchItems]);
  const publications = useMemo(() => getPublications(activeItems), [activeItems]);
  const categories = useMemo(() => {
    const map = new Map<string, { key: string; count: number }>();
    for (const item of activeItems) {
      const key = item.category?.trim() || "uncategorized";
      map.set(key, { key, count: (map.get(key)?.count ?? 0) + 1 });
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [activeItems]);
  const enriched = useMemo(() => enrichItems(activeItems), [activeItems]);
  const days = useMemo(() => getDays(enriched), [enriched]);
  const { todayKey } = useMemo(() => getRelativeKeys(), []);
  const isSourceFocused = Boolean(selectedPub);
  const manualSyncedIdSet = useMemo(() => new Set(manualSyncedIds), [manualSyncedIds]);
  const recommendedIdSet = useMemo(() => new Set(recommendedIds), [recommendedIds]);
  const modeOrder = useMemo<InboxViewMode[]>(
    () =>
      manualSyncedIds.length > 0
        ? ["recommended", "today", "manual-sync", "unread", "saved", "all"]
        : ["recommended", "today", "unread", "saved", "all"],
    [manualSyncedIds.length]
  );

  const viewFiltered = useMemo(() => {
    if (viewMode === "recommended") {
      return enriched.filter((it) => recommendedIdSet.has(it.id) && !manualSyncedIdSet.has(it.id));
    }
    if (viewMode === "manual-sync") return enriched.filter((it) => manualSyncedIdSet.has(it.id));
    if (viewMode === "today") return enriched.filter((it) => it._dayKey === todayKey);
    if (viewMode === "unread") return enriched.filter((it) => statusById[it.id] !== "read");
    if (viewMode === "saved") return enriched.filter((it) => savedById[it.id] === true);
    return enriched;
  }, [enriched, manualSyncedIdSet, recommendedIdSet, savedById, statusById, todayKey, viewMode]);
  const categoryFiltered = useMemo(
    () => (selectedCategory ? viewFiltered.filter((it) => (it.category?.trim() || "uncategorized") === selectedCategory) : viewFiltered),
    [selectedCategory, viewFiltered]
  );
  const filtered = useMemo(
    () => filterItems(categoryFiltered, isServerSearchActive ? "" : q, selectedPub, selectedDay),
    [categoryFiltered, isServerSearchActive, q, selectedPub, selectedDay]
  );

  const dailyEdition = useMemo(() => buildDailyEdition(filtered, 30, showAllEarlier), [filtered, showAllEarlier]);
  const grouped = useMemo(
    () => (selectedDay || isSourceFocused ? groupItemsByDay(filtered) : dailyEdition.grouped),
    [dailyEdition.grouped, filtered, isSourceFocused, selectedDay]
  );
  const ordered = useMemo(() => grouped.flatMap((group) => group.items), [grouped]);
  const todayStats = useMemo(
    () => getTodayStats(enriched, statusById, { todayWindowMode: "calendarDay" }),
    [enriched, statusById]
  );
  const activeSelectedIndex = ordered.length === 0 ? 0 : Math.min(selectedIndex, ordered.length - 1);
  const contextById = useMemo(() => buildContextById(activeItems, "rss"), [activeItems]);
  const olderUnreadIds = useMemo(() => {
    if (selectedDay || isSourceFocused || viewMode !== "all") return [];
    return dailyEdition.olderIds.filter((id) => statusById[id] !== "read");
  }, [dailyEdition.olderIds, isSourceFocused, selectedDay, statusById, viewMode]);

  const markInProgress = useCallback(
    (id: string) => {
      setStatusById((prev) => (prev[id] === "read" ? prev : { ...prev, [id]: "in-progress" }));
      postReadState({ messageId: id, state: "in_progress", metadata: contextById[id] }).catch(() => null);
    },
    [contextById]
  );

  const markRead = useCallback(
    (id: string) => {
      setStatusById((prev) => ({ ...prev, [id]: "read" }));
      postReadState({ messageId: id, state: "read", metadata: contextById[id] }).catch(() => null);
    },
    [contextById]
  );

  const markUnread = useCallback((id: string) => {
    setStatusById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    postReadState({ messageId: id, state: "unread" }).catch(() => null);
  }, []);

  const toggleRead = useCallback(
    (id: string) => {
      if (statusById[id] === "read") {
        markUnread(id);
        return;
      }
      markRead(id);
    },
    [markRead, markUnread, statusById]
  );

  const toggleSaved = useCallback(
    (id: string) => {
      const isSaved = savedById[id] === true;
      setSavedById((prev) => ({ ...prev, [id]: !isSaved }));
      postReadState({
        messageId: id,
        state: isSaved ? "unsaved" : "saved",
        metadata: contextById[id],
      }).catch(() => null);
    },
    [contextById, savedById]
  );

  useFeedKeyboardNavigation({
    ordered,
    activeSelectedIndex,
    setSelectedIndex,
    onOpen: markInProgress,
    onToggleRead: toggleRead,
    onToggleSaved: toggleSaved,
  });

  const catchUpOlder = useCallback(() => {
    if (olderUnreadIds.length === 0) return;
    setStatusById((prev) => {
      const next = { ...prev };
      for (const id of olderUnreadIds) next[id] = "read";
      return next;
    });
    postReadState({
      messageIds: olderUnreadIds,
      state: "read",
      contextById: olderUnreadIds.reduce<Record<string, (typeof contextById)[string]>>((acc, id) => {
        const context = contextById[id];
        if (context) acc[id] = context;
        return acc;
      }, {}),
    }).catch(() => null);
  }, [contextById, olderUnreadIds]);

  useEffect(() => {
    if (manualSyncedIds.length > 0) return;
    if (viewMode === "manual-sync") setViewMode("recommended");
  }, [manualSyncedIds.length, viewMode]);

  useEffect(() => {
    window.localStorage.setItem(
      "nr_ordered_items",
      JSON.stringify(ordered.map((it) => ({ id: it.id, subject: it.subject || "(No subject)" })))
    );
  }, [ordered]);

  useEffect(() => {
    if (session === null) router.replace("/sign-in");
  }, [session, router]);

  if (!session) return <main style={{ maxWidth: 560, margin: "80px auto", padding: 20 }}><p>Loading...</p></main>;

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
        modeOrder={modeOrder}
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
        onPublicationChange={setSelectedPub}
        onCategoryChange={setSelectedCategory}
        onDayChange={setSelectedDay}
        rightAction={
          <button
            type="button"
            onClick={syncRssFeeds}
            disabled={isSyncingRss}
            className="filter-action-btn"
            title="Sync RSS feeds now"
            style={{ gap: 6 }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10" />
              <path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14" />
            </svg>
            <span>{isSyncingRss ? "Syncing..." : "Sync feed"}</span>
          </button>
        }
      />

      {rssSyncNotice && <div style={{ margin: "-8px 0 14px", color: "var(--muted)", fontSize: 12 }}>{rssSyncNotice}</div>}
      {isServerSearchActive && (
        <div style={{ margin: "-6px 0 14px", color: "var(--muted)", fontSize: 12 }}>
          {isSearching
            ? "Searching RSS articles..."
            : searchError
              ? searchError
              : `Showing ${searchItems.length} search result${searchItems.length === 1 ? "" : "s"}.`}
        </div>
      )}

      {viewMode === "all" && !selectedDay && !isSourceFocused && (
        <ShowEarlierButton
          hiddenCount={dailyEdition.hiddenEarlierCount}
          showingAll={showAllEarlier}
          onToggle={() => setShowAllEarlier((prev) => !prev)}
        />
      )}

      {overflowBySource.length > 0 && !selectedDay && !isSourceFocused && viewMode === "all" && (
        <OverflowSources entries={overflowBySource} />
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

      {viewMode === "all" && <CatchUpOlderButton count={olderUnreadIds.length} onClick={catchUpOlder} />}
    </main>
  );
}
