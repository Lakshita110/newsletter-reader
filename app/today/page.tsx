"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { SwipeRow } from "./components/SwipeRow";
import { GmailBanner } from "./components/GmailBanner";
import { buildTodayQueue, flattenQueue, type QueueSection } from "./lib/queue";
import { prefetchForOffline } from "./lib/offline";
import { readMapFromStorage, saveMapToStorage, toReadStatusMap, toSavedMap } from "@/app/inbox/lib/client-utils";
import { postReadState } from "@/app/inbox/lib/read-state";
import type { FeedReadStatus, InboxItem } from "@/app/inbox/types";

type Tab = "today" | "saved";
type Undo = { item: InboxItem; kind: "done" | "save"; prevStatus?: FeedReadStatus; prevSaved?: boolean };

const SECTION_LABELS: Record<QueueSection, string> = {
  continue: "Continue reading",
  newsletters: "Newsletters",
  stories: "Top stories",
  covered: "Already in your newsletters",
  saved: "Saved for later",
};

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d` : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Phone-first home: one queue across newsletters and RSS. Tap to read,
 * swipe left when done, swipe right to keep for later.
 */
export default function TodayPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "saved"
      ? "saved"
      : "today"
  );
  // Paint instantly (and offline) from what was last loaded, then refresh.
  const [cached] = useState(() => {
    const raw = readMapFromStorage<unknown>("nr_today_cache");
    return {
      items: Array.isArray(raw.items) ? (raw.items as InboxItem[]) : null,
      recommendedIds: Array.isArray(raw.recommendedIds) ? (raw.recommendedIds as string[]) : [],
      rankMeta: toRankMeta(raw.rankMeta),
    };
  });
  const [items, setItems] = useState<InboxItem[]>(cached.items ?? []);
  const [recommendedIds, setRecommendedIds] = useState<string[]>(cached.recommendedIds);
  const [rankMeta, setRankMeta] = useState<RankMeta>(cached.rankMeta);
  const [rankNow, setRankNow] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [statusById, setStatusById] = useState<Record<string, FeedReadStatus>>(() =>
    readMapFromStorage<FeedReadStatus>("nr_read_status_map")
  );
  const [savedById, setSavedById] = useState<Record<string, boolean>>(() =>
    readMapFromStorage<boolean>("nr_saved_items_map")
  );
  const [isLoading, setIsLoading] = useState(cached.items === null);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [feedRes, stateRes] = await Promise.all([fetch("/api/feed/inbox"), fetch("/api/read-state")]);
      if (feedRes.status === 401) {
        setError("Signed out. Sign in again to refresh.");
        return;
      }
      if (!feedRes.ok) throw new Error(`Feed request failed (${feedRes.status})`);
      const feed = await feedRes.json();
      const nextItems: InboxItem[] = Array.isArray(feed?.items) ? feed.items : [];
      const nextRecommended: string[] = Array.isArray(feed?.rssMeta?.recommendedIds) ? feed.rssMeta.recommendedIds : [];
      const nextRankMeta = toRankMeta(feed?.rssMeta);
      setItems(nextItems);
      setRecommendedIds(nextRecommended);
      setRankMeta(nextRankMeta);
      saveMapToStorage("nr_today_cache", { items: nextItems, recommendedIds: nextRecommended, rankMeta: nextRankMeta });
      if (stateRes.ok) {
        const state = await stateRes.json();
        const nextStatus = toReadStatusMap(state);
        const nextSaved = toSavedMap(state);
        setStatusById(nextStatus);
        setSavedById(nextSaved);
        saveMapToStorage("nr_read_status_map", nextStatus);
        saveMapToStorage("nr_saved_items_map", nextSaved);
      }
    } catch (err) {
      console.error("[today] load failed", err);
      setError(navigator.onLine ? "Couldn't refresh. Showing what was last loaded." : "Offline. Showing saved copies.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus === "unauthenticated") router.replace("/sign-in");
    if (session?.user?.email) load();
  }, [session?.user?.email, sessionStatus, load, router]);

  const queue = useMemo(
    () => buildTodayQueue({ items, statusById, savedById, recommendedIds }),
    [items, statusById, savedById, recommendedIds]
  );
  const ordered = useMemo(() => (tab === "saved" ? queue.saved : flattenQueue(queue)), [queue, tab]);
  const sections: QueueSection[] = tab === "saved" ? ["saved"] : ["continue", "newsletters", "stories", "covered"];

  // Make the top of the queue readable offline.
  const orderedIds = ordered.map((i) => i.id).join(",");
  useEffect(() => {
    if (!orderedIds) return;
    const t = setTimeout(() => prefetchForOffline(orderedIds.split(",")), 1500);
    return () => clearTimeout(t);
  }, [orderedIds]);

  const showUndo = (next: Undo) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(next);
    undoTimer.current = setTimeout(() => setUndo(null), 4000);
  };

  const context = (item: InboxItem) => ({
    title: item.subject || "(No subject)",
    sourceKind: item.sourceKind ?? "gmail",
    publicationName: item.publicationName,
  });

  const setStatus = (id: string, status: FeedReadStatus | undefined) => {
    setStatusById((prev) => {
      const next = { ...prev };
      if (status) next[id] = status;
      else delete next[id];
      saveMapToStorage("nr_read_status_map", next);
      return next;
    });
  };
  const setSaved = (id: string, saved: boolean) => {
    setSavedById((prev) => {
      const next = { ...prev };
      if (saved) next[id] = true;
      else delete next[id];
      saveMapToStorage("nr_saved_items_map", next);
      return next;
    });
  };

  const markDone = (item: InboxItem) => {
    const prevStatus = statusById[item.id];
    const prevSaved = Boolean(savedById[item.id]);
    setStatus(item.id, "read");
    // Finishing a saved item also clears it from Saved.
    if (prevSaved) setSaved(item.id, false);
    postReadState({ messageId: item.id, state: "read", metadata: context(item) }).catch((e) =>
      console.error("[today] mark read failed", e)
    );
    if (prevSaved) postReadState({ messageId: item.id, state: "unsaved" }).catch(() => null);
    showUndo({ item, kind: "done", prevStatus, prevSaved });
  };

  const toggleSave = (item: InboxItem) => {
    const prevSaved = Boolean(savedById[item.id]);
    setSaved(item.id, !prevSaved);
    postReadState({ messageId: item.id, state: prevSaved ? "unsaved" : "saved", metadata: context(item) }).catch((e) =>
      console.error("[today] save failed", e)
    );
    showUndo({ item, kind: "save", prevSaved });
  };

  const undoLast = () => {
    if (!undo) return;
    const { item } = undo;
    if (undo.kind === "done") {
      setStatus(item.id, undo.prevStatus);
      postReadState({ messageId: item.id, state: undo.prevStatus === "in-progress" ? "in_progress" : "unread" }).catch(
        () => null
      );
      if (undo.prevSaved) {
        setSaved(item.id, true);
        postReadState({ messageId: item.id, state: "saved", metadata: context(item) }).catch(() => null);
      }
    } else {
      setSaved(item.id, Boolean(undo.prevSaved));
      postReadState({ messageId: item.id, state: undo.prevSaved ? "saved" : "unsaved", metadata: context(item) }).catch(
        () => null
      );
    }
    setUndo(null);
  };

  const rememberQueueForReader = () => {
    // The reader uses these for "Done → next" and for its back button.
    window.localStorage.setItem(
      "nr_ordered_items",
      JSON.stringify(ordered.map((i) => ({ id: i.id, subject: i.subject })))
    );
    window.localStorage.setItem("nr_reader_back", tab === "saved" ? "/today?tab=saved" : "/today");
  };

  const runRankNow = () => {
    setRankNow({ busy: true, error: null });
    fetch("/api/rss/rank-now", { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(typeof body?.error === "string" ? body.error : `Ranking failed (${res.status})`);
        }
        setRankNow({ busy: false, error: null });
        return load();
      })
      .catch((err: unknown) => {
        console.error("[today] rank now failed", err);
        setRankNow({ busy: false, error: err instanceof Error ? err.message : "Ranking failed" });
      });
  };

  const totalToday = queue.continue.length + queue.newsletters.length + queue.stories.length;

  return (
    <main className="today-shell">
      <header className="today-header">
        <div>
          <h1 className="today-title">{tab === "saved" ? "Saved" : "Today"}</h1>
          <p className="today-subtitle">
            {isLoading
              ? "Loading…"
              : tab === "saved"
                ? `${queue.saved.length} kept for later`
                : totalToday === 0
                  ? "All caught up."
                  : `${totalToday} to read`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link
            href="/save"
            className="today-icon-btn"
            aria-label="Save a link"
            style={{ display: "grid", placeItems: "center", textDecoration: "none" }}
          >
            +
          </Link>
          <button type="button" className="today-icon-btn" onClick={() => load()} aria-label="Refresh">
            ↻
          </button>
        </div>
      </header>

      {error && <div className="today-banner">{error}</div>}
      <GmailBanner enabled={Boolean(session?.user?.email)} />

      {sections.map((section) => {
        const list = queue[section];
        if (list.length === 0) return null;
        const rows = (
          <ul className="today-list">
            {list.map((item) => (
              <li key={item.id}>
                <SwipeRow
                  onDone={() => markDone(item)}
                  onSave={() => toggleSave(item)}
                  saveLabel={savedById[item.id] ? "Unsave" : "Save"}
                >
                  <Link
                    href={`/read/${encodeURIComponent(item.id)}`}
                    className="today-row"
                    onClick={rememberQueueForReader}
                    // A native link drag would steal the pointer and cancel the swipe.
                    draggable={false}
                  >
                    <div className="today-row-meta">
                      <span className="today-row-pub">{item.publicationName}</span>
                      <span>{relativeTime(item.date)}</span>
                      {statusById[item.id] === "in-progress" && <span className="today-dot" aria-label="In progress" />}
                    </div>
                    <div className="today-row-title">{item.subject || "(No subject)"}</div>
                    {rankMeta.reasons[item.id] && (
                      <div className="today-row-why">
                        <span aria-hidden="true">✦</span> {rankMeta.reasons[item.id]}
                      </div>
                    )}
                    {item.coveredBy ? (
                      <div className="today-row-covered">
                        Covered in {item.coveredBy.publicationName}: {item.coveredBy.subject}
                      </div>
                    ) : (
                      item.snippet && <div className="today-row-snippet">{item.snippet}</div>
                    )}
                  </Link>
                </SwipeRow>
              </li>
            ))}
          </ul>
        );
        if (section === "covered") {
          // Folded by default: these overlap with something you're already reading.
          return (
            <details key={section} className="today-section today-fold">
              <summary className="today-section-title">
                {SECTION_LABELS[section]} <span>{list.length}</span>
              </summary>
              {rows}
            </details>
          );
        }
        return (
          <section key={section} className="today-section">
            <h2 className="today-section-title">
              {section === "stories" && recommendedIds.length > 0 ? "Picked for you" : SECTION_LABELS[section]}{" "}
              <span>{list.length}</span>
            </h2>
            {section === "stories" && (
              <RankStatusLine
                meta={rankMeta}
                hasPicks={recommendedIds.length > 0}
                rankNow={rankNow}
                onRankNow={runRankNow}
              />
            )}
            {rows}
          </section>
        );
      })}

      {!isLoading && ordered.length === 0 && (
        <div className="today-empty">
          {tab === "saved"
            ? "Swipe right on anything to keep it here."
            : "Nothing left. Browse everything in the full inboxes below."}
        </div>
      )}

      <p className="today-hint">Swipe left when you&rsquo;re done · swipe right to save</p>

      {undo && (
        <div className="today-toast" role="status">
          <span>{undo.kind === "done" ? "Marked done" : savedById[undo.item.id] ? "Saved" : "Removed from saved"}</span>
          <button type="button" onClick={undoLast}>
            Undo
          </button>
        </div>
      )}

      <nav className="today-tabbar" aria-label="Sections">
        <button type="button" className={tab === "today" ? "active" : ""} onClick={() => setTab("today")}>
          Today
        </button>
        <button type="button" className={tab === "saved" ? "active" : ""} onClick={() => setTab("saved")}>
          Saved
        </button>
        <Link href="/highlights">Highlights</Link>
        <Link href="/inbox/newsletters">Browse</Link>
        <Link href="/rss/settings">Sources</Link>
      </nav>
    </main>
  );
}

/** "2h ago", but a bare date for anything older than a week. */
function agoLabel(iso: string): string {
  const rel = relativeTime(iso);
  return /^\d/.test(rel) ? `${rel} ago` : rel;
}

type RankMeta = {
  reasons: Record<string, string>;
  status: string | null;
  model: string | null;
  rankedAt: string | null;
};

function toRankMeta(raw: unknown): RankMeta {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const reasons: Record<string, string> = {};
  if (r.rankReasons && typeof r.rankReasons === "object") {
    for (const [k, v] of Object.entries(r.rankReasons as Record<string, unknown>)) {
      if (typeof v === "string") reasons[k] = v;
    }
  }
  // The cache stores the already-normalized shape under `reasons`.
  if (r.reasons && typeof r.reasons === "object") {
    for (const [k, v] of Object.entries(r.reasons as Record<string, unknown>)) {
      if (typeof v === "string") reasons[k] = v;
    }
  }
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    reasons,
    status: str(r.rankStatus) ?? str(r.status),
    model: str(r.rankModel) ?? str(r.model),
    rankedAt: str(r.rankedAt),
  };
}

/**
 * Says who picked the stories and when, or that nothing has been picked yet.
 * Before this, a failed or missing ranking looked identical to a working one
 * (stories just appeared newest-first), which is why ranking felt "not done".
 */
function RankStatusLine({
  meta,
  hasPicks,
  rankNow,
  onRankNow,
}: {
  meta: RankMeta;
  hasPicks: boolean;
  rankNow: { busy: boolean; error: string | null };
  onRankNow: () => void;
}) {
  const ranked = hasPicks && meta.status === "AI_SUCCESS";
  return (
    <div className="today-rank-status">
      <span>
        {ranked
          ? `Picked by ${meta.model ?? "AI"}${meta.rankedAt ? `, ${agoLabel(meta.rankedAt)}` : ""}`
          : "Not ranked yet, showing newest first"}
      </span>
      <button type="button" onClick={onRankNow} disabled={rankNow.busy}>
        {rankNow.busy ? "Ranking…" : ranked ? "Re-rank" : "Rank now"}
      </button>
      {rankNow.error && <span className="today-rank-error">{rankNow.error}</span>}
    </div>
  );
}
