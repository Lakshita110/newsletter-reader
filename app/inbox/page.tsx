"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

type Item = {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  publicationName: string;
  publicationKey: string;
};

export default function InboxPage() {
  const { data: session } = useSession();
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [selectedPub, setSelectedPub] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
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
    const stored = window.localStorage.getItem("nr_read_ids");
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as string[];
      setReadIds(new Set(parsed));
    } catch {
      setReadIds(new Set());
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      "nr_read_ids",
      JSON.stringify(Array.from(readIds))
    );
  }, [readIds]);

  const publications = useMemo(() => {
    const map = new Map<string, { key: string; name: string; count: number }>();
    for (const it of items) {
      const k = it.publicationKey;
      if (!k) continue;
      const prev = map.get(k);
      map.set(k, {
        key: k,
        name: it.publicationName || it.from,
        count: (prev?.count ?? 0) + 1,
      });
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [items]);

  const enriched = useMemo(() => {
    return items.map((it) => {
      const parsed = parseDate(it.date);
      const dayKey = parsed ? toDayKey(parsed) : "unknown";
      return { ...it, _date: parsed, _dayKey: dayKey };
    });
  }, [items]);

  const days = useMemo(() => {
    const map = new Map<string, { key: string; count: number }>();
    for (const it of enriched) {
      if (!it._dayKey || it._dayKey === "unknown") continue;
      const prev = map.get(it._dayKey);
      map.set(it._dayKey, {
        key: it._dayKey,
        count: (prev?.count ?? 0) + 1,
      });
    }
    return [...map.values()].sort((a, b) => b.key.localeCompare(a.key));
  }, [enriched]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return enriched.filter((it) => {
      if (selectedPub && it.publicationKey !== selectedPub) return false;
      if (selectedDay && it._dayKey !== selectedDay) return false;
      if (!query) return true;

      const hay =
        `${it.subject} ${it.from} ${it.publicationName} ${it.snippet}`.toLowerCase();
      return hay.includes(query);
    });
  }, [enriched, q, selectedPub, selectedDay]);

  const grouped = useMemo(() => {
    const byDay = new Map<string, typeof filtered>();
    for (const it of filtered) {
      const key = it._dayKey || "unknown";
      const list = byDay.get(key) ?? [];
      list.push(it);
      byDay.set(key, list);
    }

    const keys = [...byDay.keys()].sort((a, b) => {
      if (a === "unknown") return 1;
      if (b === "unknown") return -1;
      return b.localeCompare(a);
    });

    return keys.map((key) => {
      const list = byDay.get(key) ?? [];
      list.sort((a, b) => {
        const ta = a._date?.getTime() ?? 0;
        const tb = b._date?.getTime() ?? 0;
        return tb - ta;
      });
      return {
        key,
        label: key === "unknown" ? "Unknown date" : formatDayLabel(key),
        items: list,
      };
    });
  }, [filtered]);

  const ordered = useMemo(() => {
    return grouped.flatMap((group) => group.items);
  }, [grouped]);

  const todayStats = useMemo(() => {
    const { todayKey } = getRelativeKeys();
    const todayItems = enriched.filter((it) => it._dayKey === todayKey);
    const readToday = todayItems.filter((it) => readIds.has(it.id)).length;
    return { readToday, totalToday: todayItems.length };
  }, [enriched, readIds]);

  useEffect(() => {
    if (ordered.length === 0) return;
    setSelectedIndex((prev) => Math.min(prev, ordered.length - 1));
  }, [ordered.length]);

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
        const current = ordered[selectedIndex];
        if (current) {
          setReadIds((prev) => new Set(prev).add(current.id));
          fetch("/api/read-state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageId: current.id }),
          }).catch(() => null);
          router.push(`/read/${current.id}`);
        }
      } else if (event.key === "r") {
        event.preventDefault();
        const current = ordered[selectedIndex];
        if (!current) return;
        setReadIds((prev) => new Set(prev).add(current.id));
        fetch("/api/read-state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId: current.id }),
        }).catch(() => null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ordered, selectedIndex, router]);

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
      <header style={{ marginBottom: 18 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <h1 style={{ fontSize: 28, margin: 0, letterSpacing: -0.4 }}>
              Cluck&#39;s Feed
            </h1>
            <div style={{ color: "var(--muted)", fontSize: 14 }}>
              {filtered.length} shown
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              color: "var(--muted)",
              fontSize: 12,
            }}
          >
            <span>
              {todayStats.readToday} of {todayStats.totalToday} read today
            </span>
            {session?.user?.email && (
              <span style={{ whiteSpace: "nowrap" }}>
                {session.user.email}
              </span>
            )}
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              style={{
                border: "1px solid var(--faint)",
                background: "transparent",
                color: "var(--muted)",
                padding: "4px 8px",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Sign out
            </button>
          </div>
        </div>

        <div
          style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search subject, sender, snippet…"
            style={{
              flex: "1 1 260px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.10)",
              color: "var(--text)",
              padding: "10px 12px",
              borderRadius: 12,
              outline: "none",
            }}
          />

          {selectedPub && (
            <button
              onClick={() => setSelectedPub(null)}
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.18)",
                color: "var(--text)",
                padding: "10px 12px",
                borderRadius: 12,
                cursor: "pointer",
              }}
              title="Clear sender filter"
            >
              Clear sender
            </button>
          )}
        </div>
      </header>

      {/* Sender pills */}
      <section style={{ marginBottom: 18 }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            padding: 12,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
          }}
        >
          <button
            onClick={() => setSelectedPub(null)}
            style={pillStyle(selectedPub === null)}
          >
            All
          </button>

          {publications.slice(0, 16).map((p) => (
            <button
              key={p.key}
              onClick={() => setSelectedPub(p.key)}
              style={pillStyle(selectedPub === p.key)}
              title={`${p.count} in last 30d`}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 13 }}>
          Tip: start with the top 10–16 senders; later we’ll add “More…”
        </div>
      </section>

      {/* Day pills */}
      <section style={{ marginBottom: 18 }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            padding: 12,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
          }}
        >
          <button
            onClick={() => setSelectedDay(null)}
            style={pillStyle(selectedDay === null)}
          >
            All days
          </button>

          {days.map((d) => (
            <button
              key={d.key}
              onClick={() => setSelectedDay(d.key)}
              style={pillStyle(selectedDay === d.key)}
              title={`${d.count} on ${formatDayLabel(d.key)}`}
            >
              {formatDayPillLabel(d.key)}
            </button>
          ))}
        </div>
      </section>

      <div style={{ margin: "0 0 18px", color: "var(--muted)", fontSize: 13 }}>
        Keyboard: j/k (next/prev), o (open), r (mark read). Read status is
        stored for your account.
      </div>

      {/* Feed */}
      <section>
        {grouped.map((group) => (
          <div key={group.key} style={{ marginBottom: 18 }}>
            <div
              style={{
                fontSize: 13,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: 0.6,
                marginBottom: 6,
              }}
            >
              {group.label}
            </div>
            {group.items.map((it) => {
              const isSelected = ordered[selectedIndex]?.id === it.id;
              const isRead = readIds.has(it.id);
              return (
              <Link
                key={it.id}
                href={`/read/${it.id}`}
                onClick={() =>
                  {
                    setReadIds((prev) => new Set(prev).add(it.id));
                    fetch("/api/read-state", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ messageId: it.id }),
                    }).catch(() => null);
                  }
                }
                className="feed-item"
                style={{
                  display: "block",
                  padding: "14px 10px",
                  borderBottom: "1px solid var(--faint)",
                  borderRadius: 10,
                  background: isSelected ? "#f8f9ff" : "transparent",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {!isRead && (
                      <span
                        aria-label="Unread"
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 999,
                          background: "var(--accent-blue)",
                          display: "inline-block",
                        }}
                      />
                    )}
                    <div
                      style={{
                        fontSize: 17,
                        fontWeight: 500,
                        letterSpacing: -0.2,
                        opacity: isRead ? 0.7 : 1,
                      }}
                    >
                      {it.subject || "(No subject)"}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 6,
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    opacity: isRead ? 0.7 : 1,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      padding: "2px 8px",
                      borderRadius: 6,
                      background: "#f1f5ff",
                      color: "var(--accent-blue)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {it.publicationName}
                  </span>
                  <span
                    style={{
                      color: "var(--muted)",
                      fontSize: 12,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {it.date}
                  </span>
                </div>

                {it.snippet && (
                  <div
                    style={{
                      marginTop: 8,
                      color: "var(--muted)",
                      fontSize: 14,
                      lineHeight: 1.45,
                      opacity: isRead ? 0.7 : 1,
                    }}
                  >
                    {it.snippet}
                  </div>
                )}
              </Link>
              );
            })}
          </div>
        ))}
      </section>
    </main>
  );
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    cursor: "pointer",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 13,
    border: "1px solid var(--faint)",
    background: active ? "#eef2ff" : "transparent",
    color: active ? "var(--accent-blue)" : "var(--muted)",
  };
}

function parseDate(value: string): Date | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDayLabel(dayKey: string): string {
  const { todayKey, yesterdayKey } = getRelativeKeys();
  if (dayKey === todayKey) return "Today";
  if (dayKey === yesterdayKey) return "Yesterday";

  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

function formatDayPillLabel(dayKey: string): string {
  const { todayKey, yesterdayKey } = getRelativeKeys();
  if (dayKey === todayKey) return "Today";
  if (dayKey === yesterdayKey) return "Yesterday";

  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function getRelativeKeys() {
  const now = new Date();
  const todayKey = toDayKey(now);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  const yesterdayKey = toDayKey(y);
  return { todayKey, yesterdayKey };
}
