"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { DayPills, PublicationPills } from "./components/FilterPills";
import { FeedList } from "./components/FeedList";
import { InboxHeader } from "./components/InboxHeader";
import {
  enrichItems,
  filterItems,
  getDays,
  getPublications,
  getTodayStats,
  groupItemsByDay,
} from "./lib/derive";
import type { InboxItem } from "./types";

export default function InboxPage() {
  const { data: session } = useSession();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [q, setQ] = useState("");
  const [selectedPub, setSelectedPub] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    const stored = window.localStorage.getItem("nr_read_ids");
    if (!stored) return new Set();
    try {
      const parsed = JSON.parse(stored) as string[];
      return new Set(parsed);
    } catch {
      return new Set();
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
      const ids = Array.isArray(data?.readIds) ? data.readIds : [];
      setReadIds(new Set(ids));
    })();
  }, [session?.user?.email]);


  useEffect(() => {
    window.localStorage.setItem("nr_read_ids", JSON.stringify(Array.from(readIds)));
  }, [readIds]);

  const publications = useMemo(() => getPublications(items), [items]);
  const enriched = useMemo(() => enrichItems(items), [items]);
  const days = useMemo(() => getDays(enriched), [enriched]);

  const filtered = useMemo(
    () => filterItems(enriched, q, selectedPub, selectedDay),
    [enriched, q, selectedPub, selectedDay]
  );

  const grouped = useMemo(() => groupItemsByDay(filtered), [filtered]);

  const ordered = useMemo(() => grouped.flatMap((group) => group.items), [grouped]);

  const todayStats = useMemo(() => getTodayStats(enriched, readIds), [enriched, readIds]);
  const activeSelectedIndex = ordered.length === 0 ? 0 : Math.min(selectedIndex, ordered.length - 1);

  const markRead = (id: string) => {
    setReadIds((prev) => new Set(prev).add(id));
    fetch("/api/read-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: id }),
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
          markRead(current.id);
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
        shownCount={filtered.length}
        todayStats={todayStats}
        userEmail={session.user?.email}
        q={q}
        onQueryChange={setQ}
        hasSelectedPublication={Boolean(selectedPub)}
        onClearPublication={() => setSelectedPub(null)}
      />

      <PublicationPills
        selectedPub={selectedPub}
        publications={publications}
        onSelect={setSelectedPub}
      />

      <DayPills selectedDay={selectedDay} days={days} onSelect={setSelectedDay} />

      <div style={{ margin: "0 0 18px", color: "var(--muted)", fontSize: 13 }}>
        Keyboard: j/k (next/prev), o (open), r (mark read). Read status is stored for your
        account.
      </div>

      <FeedList
        grouped={grouped}
        ordered={ordered}
        selectedIndex={activeSelectedIndex}
        readIds={readIds}
        onMarkRead={markRead}
      />
    </main>
  );
}
