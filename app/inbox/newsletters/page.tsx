"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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

function isTypingTarget(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node) return false;
  return node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable;
}

function escapeSelectorValue(value: string): string {
  if (typeof window !== "undefined" && window.CSS?.escape) return window.CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

export default function NewslettersInboxPage() {
  const { data: session } = useSession();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [q, setQ] = useState("");
  const [viewMode, setViewMode] = useState<InboxViewMode>("today");
  const [selectedPub, setSelectedPub] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showAllEarlier, setShowAllEarlier] = useState(false);
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
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/feed/inbox?kind=newsletters");
      const data = await res.json();
      setItems(Array.isArray(data?.items) ? data.items : []);
    })();
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
  }, [session?.user?.email]);

  useEffect(() => {
    window.localStorage.setItem("nr_read_status_map", JSON.stringify(statusById));
  }, [statusById]);

  useEffect(() => {
    window.localStorage.setItem("nr_saved_items_map", JSON.stringify(savedById));
  }, [savedById]);

  const publications = useMemo(() => getPublications(items), [items]);
  const enriched = useMemo(() => enrichItems(items), [items]);
  const days = useMemo(() => getDays(enriched), [enriched]);
  const { todayKey } = useMemo(() => getRelativeKeys(), []);

  const viewFiltered = useMemo(() => {
    return enriched.filter((it) => {
      if (viewMode === "today") return it._dayKey === todayKey;
      if (viewMode === "unread") return statusById[it.id] !== "read";
      if (viewMode === "saved") return savedById[it.id] === true;
      return true;
    });
  }, [enriched, savedById, statusById, todayKey, viewMode]);

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

  const todayStats = useMemo(() => getTodayStats(enriched, statusById), [enriched, statusById]);
  const activeSelectedIndex =
    ordered.length === 0 ? 0 : Math.min(selectedIndex, ordered.length - 1);
  const olderUnreadIds = useMemo(() => {
    if (selectedDay || viewMode !== "all") return [];
    return dailyEdition.olderIds.filter((id) => statusById[id] !== "read");
  }, [dailyEdition.olderIds, selectedDay, statusById, viewMode]);
  const contextById = useMemo(() => {
    const next: Record<string, { title: string; sourceKind: "gmail" | "rss"; publicationName: string }> =
      {};
    for (const item of items) {
      next[item.id] = {
        title: item.subject || "(No subject)",
        sourceKind: item.sourceKind ?? "gmail",
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
      <InboxModeTabs mode="newsletters" />
      <InboxHeader
        unreadCount={enriched.filter((it) => statusById[it.id] !== "read").length}
        todayCount={todayStats.totalToday}
        userEmail={session.user?.email}
        q={q}
        onQueryChange={setQ}
      />

      <InboxFilters
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        selectedPub={selectedPub}
        selectedCategory={null}
        selectedDay={selectedDay}
        publicationOptions={publications.map((p) => ({ key: p.key, label: p.name }))}
        dayOptions={toDayOptions(days)}
        onPublicationChange={setSelectedPub}
        onDayChange={setSelectedDay}
      />
      {viewMode === "all" && !selectedDay && dailyEdition.hiddenEarlierCount > 0 && (
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
