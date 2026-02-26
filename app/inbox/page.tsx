"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { DayPills, PublicationPills } from "./components/FilterPills";
import { FeedList } from "./components/FeedList";
import { InboxHeader } from "./components/InboxHeader";
import {
  buildDailyEdition,
  enrichItems,
  filterItems,
  getDays,
  getPublications,
  getTodayStats,
  groupItemsByDay,
} from "./lib/derive";
import type { FeedReadStatus, InboxItem } from "./types";

export default function InboxPage() {
  const { data: session } = useSession();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [q, setQ] = useState("");
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
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/gmail/inbox");
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
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

  const todayStats = useMemo(
    () => getTodayStats(enriched, statusById),
    [enriched, statusById]
  );
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
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
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
    <main style={{ maxWidth: 780, margin: "44px auto", padding: 20 }}>
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
        Keyboard: j/k (next/prev), o (open), r (mark read). Daily edition shows up to 30
        items by default.
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
