"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { SwipeHint, SwipeRow } from "./components/SwipeRow";
import { applyFrozenOrder, freezeOrder, readFrozenOrder, writeFrozenOrder, type FrozenOrder } from "./lib/stable-order";
import { AppNav } from "@/app/components/AppNav";
import { GmailBanner } from "./components/GmailBanner";
import { faviconDomain } from "@/lib/lead-image";
import { buildTodayQueue, isOpenItem, readingOrder, type QueueSection } from "./lib/queue";
import { prefetchForOffline } from "./lib/offline";
import { readMapFromStorage, saveMapToStorage, toReadStatusMap, toSavedMap } from "@/app/lib/client-utils";
import { applyLocalEditsSince, postReadState, readStateClock } from "@/app/lib/read-state";
import type { FeedReadStatus, InboxItem } from "@/app/lib/feed-types";

type Tab = "today" | "newsletters" | "saved";

const TAB_TITLES: Record<Tab, string> = { today: "Today", newsletters: "Newsletters", saved: "Saved" };

function tabFromUrl(): Tab {
  if (typeof window === "undefined") return "today";
  const tab = new URLSearchParams(window.location.search).get("tab");
  return tab === "saved" || tab === "newsletters" ? tab : "today";
}
type Undo =
  | { item: InboxItem; kind: "done" | "save"; prevStatus?: FeedReadStatus; prevSaved?: boolean }
  // "Mark all as read": remembers each item's earlier status so Undo restores exactly that.
  | { kind: "bulk"; items: InboxItem[]; prevStatuses: Record<string, FeedReadStatus | undefined> };

const SECTION_LABELS: Record<QueueSection, string> = {
  continue: "Continue reading",
  feed: "For today",
  more: "More stories",
  covered: "Already in your newsletters",
  newsletters: "Newsletters",
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
  const [tab, setTab] = useState<Tab>(tabFromUrl);
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
  const [frozen, setFrozen] = useState<FrozenOrder | null>(() => readFrozenOrder());
  const [touched, setTouched] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [undo, setUndo] = useState<Undo | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const since = readStateClock();
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
      setLoadedOnce(true);
      if (stateRes.ok) {
        const state = await stateRes.json();
        // The feed request can take seconds; a swipe made meanwhile must not be
        // undone by this older snapshot (see app/lib/read-state.ts).
        const { status: nextStatus, saved: nextSaved } = applyLocalEditsSince(
          since,
          toReadStatusMap(state),
          toSavedMap(state)
        );
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

  const freshQueue = useMemo(
    () => buildTodayQueue({ items, statusById, savedById, recommendedIds }),
    [items, statusById, savedById, recommendedIds]
  );
  // Freeze the order once fresh data has loaded or she starts touching the
  // page, whichever comes first (app/today/lib/stable-order.ts). Setting state
  // during render is React's documented way to derive from changing data.
  const canFreeze = !isLoading && items.length > 0 && (loadedOnce || touched);
  if (!frozen && canFreeze) {
    const next = freezeOrder(freshQueue);
    setFrozen(next);
    writeFrozenOrder(next);
  }
  const queue = useMemo(() => {
    const open = new Map(items.filter((i) => isOpenItem(i, statusById, savedById)).map((i) => [i.id, i]));
    return applyFrozenOrder(freshQueue, frozen, open);
  }, [freshQueue, frozen, items, statusById, savedById]);
  /** Drop the frozen order so the next render shows (and re-freezes) the fresh one. */
  const unfreeze = () => {
    setFrozen(null);
    writeFrozenOrder(null);
  };
  /** Explicit refresh: fetch, then show (and freeze) the fresh order. */
  const refresh = () => {
    unfreeze();
    setIsLoading(true);
    return load();
  };
  const pendingCount = tab === "newsletters" ? queue.pending.newsletters : tab === "today" ? queue.pending.feed : 0;
  const ordered = useMemo(() => readingOrder(queue, tab), [queue, tab]);
  const sections: QueueSection[] =
    tab === "saved" ? ["saved"] : tab === "newsletters" ? ["newsletters"] : ["continue", "feed", "more", "covered"];

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
    // Undoing a whole list deserves longer to notice than one row.
    undoTimer.current = setTimeout(() => setUndo(null), next.kind === "bulk" ? 8000 : 4000);
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
    postReadState({ messageId: item.id, state: "dismissed", metadata: context(item) }).catch((e) => {
      // Put it back and say so: a done that silently didn't save is the bug she hit.
      console.error("[today] mark read failed", e);
      setStatus(item.id, prevStatus);
      setError("Couldn't save that. It's back in your list; try again.");
    });
    if (prevSaved) postReadState({ messageId: item.id, state: "unsaved" }).catch(() => null);
    showUndo({ item, kind: "done", prevStatus, prevSaved });
  };

  const markOpened = (item: InboxItem) => {
    if (!statusById[item.id]) setStatus(item.id, "in-progress");
    postReadState({ messageId: item.id, state: "opened", metadata: context(item) }).catch((e) =>
      // Only the in-progress dot depends on this; the item itself is unaffected.
      console.error("[today] could not record the open", e)
    );
  };

  const toggleSave = (item: InboxItem) => {
    const prevSaved = Boolean(savedById[item.id]);
    setSaved(item.id, !prevSaved);
    postReadState({ messageId: item.id, state: prevSaved ? "unsaved" : "saved", metadata: context(item) }).catch(
      (e) => {
        console.error("[today] save failed", e);
        setSaved(item.id, prevSaved);
        setError("Couldn't save that change. Try again.");
      }
    );
    showUndo({ item, kind: "save", prevSaved });
  };

  const markAllDone = (items: InboxItem[]) => {
    if (items.length === 0) return;
    const prevStatuses = Object.fromEntries(items.map((item) => [item.id, statusById[item.id]]));
    setStatusById((prev) => {
      const next = { ...prev };
      for (const item of items) next[item.id] = "read";
      saveMapToStorage("nr_read_status_map", next);
      return next;
    });
    // One request for the whole list: the API takes messageIds + per-item context.
    postReadState({
      messageIds: items.map((item) => item.id),
      state: "dismissed",
      contextById: Object.fromEntries(items.map((item) => [item.id, context(item)])),
    }).catch((e) => {
      console.error("[today] mark all read failed", e);
      setStatusById((prev) => {
        const next = { ...prev };
        for (const item of items) {
          const status = prevStatuses[item.id];
          if (status) next[item.id] = status;
          else delete next[item.id];
        }
        saveMapToStorage("nr_read_status_map", next);
        return next;
      });
      setError("Couldn't mark those as read. Try again.");
    });
    showUndo({ kind: "bulk", items, prevStatuses });
  };

  const undoLast = () => {
    if (!undo) return;
    if (undo.kind === "bulk") {
      const back = (status: FeedReadStatus | undefined) => undo.items.filter((i) => undo.prevStatuses[i.id] === status);
      setStatusById((prev) => {
        const next = { ...prev };
        for (const item of undo.items) {
          const status = undo.prevStatuses[item.id];
          if (status) next[item.id] = status;
          else delete next[item.id];
        }
        saveMapToStorage("nr_read_status_map", next);
        return next;
      });
      for (const [status, state] of [
        [undefined, "unread"],
        ["in-progress", "in_progress"],
      ] as const) {
        const ids = back(status).map((i) => i.id);
        if (ids.length > 0)
          postReadState({ messageIds: ids, state }).catch((e) => console.error("[today] undo mark all failed", e));
      }
      setUndo(null);
      return;
    }
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
    window.localStorage.setItem("nr_reader_back", tab === "today" ? "/today" : `/today?tab=${tab}`);
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
        refresh();
      })
      .catch((err: unknown) => {
        console.error("[today] rank now failed", err);
        setRankNow({ busy: false, error: err instanceof Error ? err.message : "Ranking failed" });
      });
  };

  return (
    <main
      className="today-shell"
      // Touching the page freezes its order, even if fresh data is still loading.
      onPointerDown={() => {
        if (!touched) setTouched(true);
      }}
    >
      <header className="today-header">
        <div>
          <h1 className="today-title">{TAB_TITLES[tab]}</h1>
          <p className="today-subtitle">
            {isLoading
              ? "Loading…"
              : tab === "saved"
                ? `${queue.saved.length} kept for later`
                : ordered.length === 0
                  ? "All caught up."
                  : tab === "newsletters"
                    ? `${ordered.length} unread`
                    : `${ordered.length} to read`}
            {!isLoading && tab !== "saved" && ordered.length > 1 && (
              <>
                {" · "}
                <button type="button" className="today-text-btn" onClick={() => markAllDone(ordered)}>
                  Mark all read
                </button>
              </>
            )}
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
          <button type="button" className="today-icon-btn" onClick={refresh} aria-label="Refresh">
            ↻
          </button>
        </div>
      </header>

      {error && <div className="today-banner">{error}</div>}
      <GmailBanner enabled={Boolean(session?.user?.email)} />
      {pendingCount > 0 && (
        <button type="button" className="today-new-pill" onClick={unfreeze}>
          {pendingCount} new · Show
        </button>
      )}
      {ordered.length > 0 && <SwipeHint />}

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
                  {opensOriginal(item, tab) ? (
                    // RSS stories open on the publisher's site: their pages read better than
                    // our extraction. Opening one only marks it as started; it stays in the
                    // list until she swipes it done or saves it.
                    <a
                      href={item.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="today-row"
                      onClick={() => markOpened(item)}
                      draggable={false}
                    >
                      <RowBody item={item} inProgress={statusById[item.id] === "in-progress"} />
                    </a>
                  ) : (
                    <Link
                      href={`/read/${encodeURIComponent(item.id)}`}
                      className="today-row"
                      onClick={rememberQueueForReader}
                      // A native link drag would steal the pointer and cancel the swipe.
                      draggable={false}
                    >
                      <RowBody item={item} inProgress={statusById[item.id] === "in-progress"} />
                    </Link>
                  )}
                </SwipeRow>
                {/* Mouse users get buttons instead of a swipe; CSS only shows them on hover-capable pointers. */}
                <div className="today-row-actions">
                  <button type="button" onClick={() => toggleSave(item)}>
                    {savedById[item.id] ? "Unsave" : "Save"}
                  </button>
                  <button type="button" onClick={() => markDone(item)}>
                    Done
                  </button>
                </div>
              </li>
            ))}
          </ul>
        );
        if (section === "more" || section === "covered") {
          // Folded by default: the stories past Today's cap, and ones a newsletter already covered.
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
          <section key={section} className={`today-section today-section-${section}`}>
            {/* A single-list tab needs no heading; Today labels its feed only under "Continue reading". */}
            {(section === "continue" || (section === "feed" && queue.continue.length > 0)) && (
              <h2 className="today-section-title">
                {SECTION_LABELS[section]} <span>{list.length}</span>
              </h2>
            )}
            {section === "feed" && (
              <RankStatusLine
                meta={rankMeta}
                hasPicks={recommendedIds.length > 0}
                rankNow={rankNow}
                onRankNow={runRankNow}
              />
            )}
            {rows}
            {section === "newsletters" && (
              <p className="today-section-note">
                Missing one? <Link href="/settings">Add its sender in Settings</Link>.
              </p>
            )}
          </section>
        );
      })}

      {!isLoading && ordered.length === 0 && (
        <div className="today-empty">
          {tab === "saved"
            ? "Swipe right on anything to keep it here."
            : tab === "newsletters"
              ? "No unread newsletters."
              : "Nothing left for today."}
        </div>
      )}

      {!isLoading && tab !== "saved" && (
        <p className="recap-footer">
          <Link href="/recap">Your week in reading →</Link>
        </p>
      )}

      {undo && (
        <div className="today-toast" role="status">
          <span>
            {undo.kind === "bulk"
              ? `Marked ${undo.items.length} as read`
              : undo.kind === "done"
                ? "Marked done"
                : savedById[undo.item.id]
                  ? "Saved"
                  : "Removed from saved"}
          </span>
          <button type="button" onClick={undoLast}>
            Undo
          </button>
        </div>
      )}

      <AppNav active={tab} onTab={setTab} />
    </main>
  );
}

/** "2h ago", but a bare date for anything older than a week. */
function agoLabel(iso: string): string {
  const rel = relativeTime(iso);
  return /^\d/.test(rel) ? `${rel} ago` : rel;
}

type RankMeta = {
  status: string | null;
  model: string | null;
  rankedAt: string | null;
};

function toRankMeta(raw: unknown): RankMeta {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
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

/**
 * The source site's icon next to its name. Served by DuckDuckGo's icon
 * service (only the domain is sent), and hidden if the site has none.
 */
function SourceIcon({ item }: { item: InboxItem }) {
  const domain = faviconDomain(item.externalUrl, item.from);
  if (!domain) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny remote icon, no optimizer config
    <img
      className="today-row-icon"
      src={`https://icons.duckduckgo.com/ip3/${domain}.ico`}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={(e) => (e.currentTarget.style.display = "none")}
    />
  );
}

/**
 * Newsletters (and anything saved) open in the in-app reader, where the full
 * issue is stored. RSS stories open the original page instead.
 */
function opensOriginal(item: InboxItem, tab: string): item is InboxItem & { externalUrl: string } {
  // Newsletter-style posts read better in the reader, like email newsletters.
  return tab === "today" && item.sourceKind === "rss" && !item.longform && Boolean(item.externalUrl);
}

function RowBody({ item, inProgress }: { item: InboxItem; inProgress: boolean }) {
  return (
    <>
      {item.imageUrl && (
        // Lead photo; hidden if it fails to load rather than leaving a broken box.
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote hosts, no optimizer config
        <img
          className="today-row-thumb"
          src={item.imageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
      )}
      <div className="today-row-meta">
        <SourceIcon item={item} />
        <span className="today-row-pub">{item.publicationName}</span>
        <span>{relativeTime(item.date)}</span>
        {item.readMinutes && <span>{item.readMinutes} min</span>}
        {inProgress && <span className="today-dot" aria-label="In progress" />}
      </div>
      <div className="today-row-title">{item.subject || "(No subject)"}</div>
      {item.coveredBy ? (
        <div className="today-row-covered">
          Covered in {item.coveredBy.publicationName}: {item.coveredBy.subject}
        </div>
      ) : (
        item.snippet && <div className="today-row-snippet">{item.snippet}</div>
      )}
    </>
  );
}
