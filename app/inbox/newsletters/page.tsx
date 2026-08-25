"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { InboxFilters, type InboxViewMode, toDayOptions } from "../components/FilterPills";
import { FeedList } from "../components/FeedList";
import { FeedDeck } from "../components/FeedDeck";
import { UiModeToggle, useUiMode } from "@/app/components/UiModeToggle";
import { CatchUpOlderButton, ShowEarlierButton } from "../components/FeedControls";
import { InboxHeader } from "../components/InboxHeader";
import { InboxModeTabs } from "../components/InboxModeTabs";
import {
  buildDailyEdition,
  enrichItems,
  filterByViewMode,
  filterItems,
  getDays,
  getPublications,
  getTodayStats,
  groupItemsByDay,
} from "../lib/derive";
import { readMapFromStorage, saveMapToStorage, toReadStatusMap, toSavedMap } from "../lib/client-utils";
import { buildContextById, postReadState } from "../lib/read-state";
import { useFeedKeyboardNavigation } from "../hooks/useFeedKeyboardNavigation";
import type { FeedReadStatus, InboxItem } from "../types";

export default function NewslettersInboxPage() {
  const { data: session } = useSession();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [q, setQ] = useState("");
  const [viewMode, setViewMode] = useState<InboxViewMode>("today");
  const [selectedPub, setSelectedPub] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showAllEarlier, setShowAllEarlier] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statusById, setStatusById] = useState<Record<string, FeedReadStatus>>(() =>
    readMapFromStorage<FeedReadStatus>("nr_read_status_map")
  );
  const [savedById, setSavedById] = useState<Record<string, boolean>>(() =>
    readMapFromStorage<boolean>("nr_saved_items_map")
  );
  const [uiMode, setUiMode] = useUiMode();
  const [loadError, setLoadError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/feed/inbox?kind=newsletters");
        if (!res.ok) {
          setLoadError(
            res.status === 401
              ? "Signed out — sign back in to load your newsletters."
              : `Couldn't load your newsletters (${res.status}).`
          );
          return;
        }
        setLoadError(null);
        const data = await res.json();
        setItems(Array.isArray(data?.items) ? data.items : []);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

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

  const publications = useMemo(() => getPublications(items), [items]);
  const enriched = useMemo(() => enrichItems(items), [items]);
  const days = useMemo(() => getDays(enriched), [enriched]);
  const viewFiltered = useMemo(
    () =>
      filterByViewMode(enriched, {
        viewMode,
        statusById,
        savedById,
        rolling24hCutoffMs: 0,
        todayWindowMode: "calendarDay",
      }),
    [enriched, savedById, statusById, viewMode]
  );

  const filtered = useMemo(
    () => filterItems(viewFiltered, q, selectedPub, selectedDay),
    [viewFiltered, q, selectedPub, selectedDay]
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
  const todayStats = useMemo(
    () => getTodayStats(enriched, statusById, { todayWindowMode: "calendarDay" }),
    [enriched, statusById]
  );
  const activeSelectedIndex = ordered.length === 0 ? 0 : Math.min(selectedIndex, ordered.length - 1);
  const contextById = useMemo(() => buildContextById(items, "gmail"), [items]);
  const olderUnreadIds = useMemo(() => {
    if (selectedDay || viewMode !== "all") return [];
    return dailyEdition.olderIds.filter((id) => statusById[id] !== "read");
  }, [dailyEdition.olderIds, selectedDay, statusById, viewMode]);

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

  useFeedKeyboardNavigation({
    ordered,
    activeSelectedIndex,
    setSelectedIndex,
    onOpen: markInProgress,
    onToggleRead: toggleRead,
    onToggleSaved: toggleSaved,
    enabled: uiMode === "list",
  });

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
      {uiMode === "cards" ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <UiModeToggle uiMode={uiMode} onChange={setUiMode} />
        </div>
      ) : (
        <>
          <InboxModeTabs mode="newsletters" />
          <InboxHeader
            todayCount={todayStats.totalToday}
            isLoading={isLoading}
            mode="newsletters"
            userEmail={session.user?.email}
            q={q}
            onQueryChange={setQ}
            uiMode={uiMode}
            onUiModeChange={setUiMode}
          />

          <InboxFilters
            viewMode={viewMode}
            modeOrder={["today", "unread", "saved", "all"]}
            onViewModeChange={setViewMode}
            selectedPub={selectedPub}
            selectedCategory={null}
            selectedDay={selectedDay}
            publicationOptions={publications.map((p) => ({ key: p.key, label: p.name }))}
            dayOptions={toDayOptions(days)}
            onPublicationChange={setSelectedPub}
            onDayChange={(key) => {
              setSelectedDay(key);
              if (key) setViewMode("all");
            }}
          />
        </>
      )}

      {loadError && <div style={{ margin: "-8px 0 14px", color: "var(--danger, #d33)", fontSize: 12 }}>{loadError}</div>}

      {viewMode === "all" && !selectedDay && uiMode === "list" && (
        <ShowEarlierButton
          hiddenCount={dailyEdition.hiddenEarlierCount}
          showingAll={showAllEarlier}
          onToggle={() => setShowAllEarlier((prev) => !prev)}
        />
      )}

      {isLoading && (
        <div className="feed-loading-rows" aria-label="Loading newsletters…">
          {[140, 180, 120, 160, 100].map((w, i) => (
            <div key={i} className="feed-loading-row">
              <span className="skeleton-inline" style={{ width: w, height: 13 }} />
              <span className="skeleton-inline" style={{ width: "60%", height: 11 }} />
            </div>
          ))}
        </div>
      )}

      {!isLoading &&
        (uiMode === "cards" ? (
          <FeedDeck
            ordered={ordered}
            statusById={statusById}
            savedById={savedById}
            onOpen={markInProgress}
            onMarkRead={markRead}
            onToggleRead={toggleRead}
            onToggleSaved={toggleSaved}
            onExitDeck={() => setUiMode("list")}
          />
        ) : (
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
        ))}

      {viewMode === "all" && uiMode === "list" && (
        <CatchUpOlderButton count={olderUnreadIds.length} onClick={catchUpOlder} />
      )}
    </main>
  );
}
