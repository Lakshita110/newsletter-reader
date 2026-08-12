"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "../lib/date";
import { summarizeSnippet } from "../lib/text";
import { isTypingTarget } from "../lib/client-utils";
import {
  actionForSwipe,
  advanceIndex,
  exitTransform,
  resolveSwipe,
  retreatIndex,
  SWIPE_DISTANCE_THRESHOLD,
  type SwipeDirection,
} from "../lib/deck";
import type { EnrichedInboxItem, FeedReadStatus } from "../types";

const EXIT_MS = 180;

function categoryToneClass(value: string | null | undefined): string {
  return `category-tone-${(value ?? "other").toLowerCase()}`;
}

type Props = {
  ordered: EnrichedInboxItem[];
  statusById: Record<string, FeedReadStatus>;
  savedById?: Record<string, boolean>;
  rankReasons?: Record<string, string>;
  onOpen: (id: string) => void;
  onMarkRead: (id: string) => void;
  onToggleRead?: (id: string) => void;
  onOpenExternal?: (url: string) => void;
  onToggleSaved?: (id: string) => void;
  onDelete?: (id: string) => void;
  onExitDeck?: () => void;
};

export function FeedDeck({
  ordered,
  statusById,
  savedById,
  rankReasons,
  onOpen,
  onMarkRead,
  onToggleRead,
  onOpenExternal,
  onToggleSaved,
  onDelete,
  onExitDeck,
}: Props) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [exiting, setExiting] = useState<SwipeDirection | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The deck is a window onto a list the page re-filters underneath us
  // (search, view mode change, delete, or an item leaving the "unread" filter
  // because we just marked it read). Resetting to the front is the only
  // interpretation that can't strand the user past the end. Adjusting during
  // render rather than in an effect avoids a wasted pass showing a stale card.
  const [lastLength, setLastLength] = useState(ordered.length);
  if (lastLength !== ordered.length) {
    setLastLength(ordered.length);
    setIndex(0);
  }

  useEffect(() => {
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, []);

  const current = ordered[index];
  const next = ordered[index + 1];

  const openItem = useCallback(
    (id: string) => {
      onOpen(id);
      router.push(`/read/${id}`);
    },
    [onOpen, router]
  );

  const openExternal = useCallback(
    (url: string) => {
      if (onOpenExternal) {
        onOpenExternal(url);
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    },
    [onOpenExternal]
  );

  /** Run the action a direction maps to, then move the deck forward. */
  const commitSwipe = useCallback(
    (direction: SwipeDirection, id: string) => {
      const action = actionForSwipe(direction, id);

      switch (action.kind) {
        case "toggleSaved":
          if (!onToggleSaved) {
            setAnnouncement("Saving is unavailable here");
            break;
          }
          onToggleSaved(action.id);
          setAnnouncement(savedById?.[action.id] === true ? "Removed from saved" : "Saved for later");
          break;
        case "markRead":
          onMarkRead(action.id);
          setAnnouncement("Marked read");
          break;
        case "open":
          openItem(action.id);
          return; // navigating away; don't advance the deck
        case "skip":
          setAnnouncement("Skipped");
          break;
      }

      setIndex((prev) => advanceIndex(prev, ordered.length));
    },
    [onMarkRead, onToggleSaved, openItem, ordered.length, savedById]
  );

  /** Animate the card off-screen, then commit. */
  const flyOut = useCallback(
    (direction: SwipeDirection, id: string) => {
      if (exiting) return;
      setDrag(null);
      setExiting(direction);
      exitTimer.current = setTimeout(() => {
        setExiting(null);
        commitSwipe(direction, id);
      }, EXIT_MS);
    },
    [commitSwipe, exiting]
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (exiting) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { x: event.clientX, y: event.clientY };
    setDrag({ dx: 0, dy: 0 });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start) return;
    setDrag({ dx: event.clientX - start.x, dy: event.clientY - start.y });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    dragStart.current = null;
    if (!start || !current) {
      setDrag(null);
      return;
    }

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const direction = resolveSwipe(dx, dy);

    if (!direction) {
      // A drag that never really moved is a tap: open the item.
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
        setDrag(null);
        openItem(current.id);
        return;
      }
      setDrag(null);
      return;
    }

    flyOut(direction, current.id);
  };

  // Same letters as useFeedKeyboardNavigation so muscle memory carries over.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || !current) return;

      if (event.key === "ArrowRight" || event.key === "j") {
        event.preventDefault();
        setIndex((prev) => advanceIndex(prev, ordered.length));
      } else if (event.key === "ArrowLeft" || event.key === "k") {
        event.preventDefault();
        setIndex(retreatIndex);
      } else if (event.key === "o" || event.key === "Enter") {
        event.preventDefault();
        openItem(current.id);
      } else if (event.key === "s" && onToggleSaved) {
        event.preventDefault();
        onToggleSaved(current.id);
      } else if (event.key === "r") {
        event.preventDefault();
        if (onToggleRead) onToggleRead(current.id);
        else onMarkRead(current.id);
      } else if (event.key === "f" && current.externalUrl) {
        event.preventDefault();
        openExternal(current.externalUrl);
      } else if (event.key === "d" && onDelete && current.sourceKind === "rss") {
        event.preventDefault();
        onDelete(current.id);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    current,
    onDelete,
    onMarkRead,
    onToggleRead,
    onToggleSaved,
    openExternal,
    openItem,
    ordered.length,
  ]);

  if (ordered.length === 0) {
    return (
      <section className="feed-deck-empty">
        <p>Nothing matches these filters.</p>
      </section>
    );
  }

  if (!current) {
    return (
      <section className="feed-deck-empty">
        <p className="feed-deck-empty-title">All caught up</p>
        <p>You&apos;ve been through all {ordered.length} items.</p>
        <div className="feed-deck-empty-actions">
          <button type="button" className="feed-item-action-btn" onClick={() => setIndex(0)}>
            Start over
          </button>
          {onExitDeck && (
            <button type="button" className="feed-item-action-btn" onClick={onExitDeck}>
              Back to list
            </button>
          )}
        </div>
      </section>
    );
  }

  const status = statusById[current.id] ?? "unread";
  const isRead = status === "read";
  const isSaved = savedById?.[current.id] === true;
  const rankReason = rankReasons?.[current.id];
  const dx = drag?.dx ?? 0;
  const dy = drag?.dy ?? 0;

  const cardTransform = exiting
    ? exitTransform(exiting)
    : drag
      ? `translate(${dx}px, ${dy}px) rotate(${dx / 22}deg)`
      : "translate(0, 0)";

  // Badge opacity tracks drag progress so the user can see what they're about
  // to trigger before they let go.
  const progress = (value: number) => Math.min(Math.abs(value) / SWIPE_DISTANCE_THRESHOLD, 1);
  const horizontalDominant = Math.abs(dx) >= Math.abs(dy);
  const saveHint = horizontalDominant && dx > 0 ? progress(dx) : 0;
  const readHint = horizontalDominant && dx < 0 ? progress(dx) : 0;
  const openHint = !horizontalDominant && dy < 0 ? progress(dy) : 0;
  const skipHint = !horizontalDominant && dy > 0 ? progress(dy) : 0;

  return (
    <section className="feed-deck" aria-label="Swipe through articles">
      <div className="feed-deck-progress">
        {index + 1} of {ordered.length}
      </div>

      <div className="feed-deck-stage">
        {next && (
          <article className="feed-deck-card feed-deck-card-behind" aria-hidden="true">
            <div className="feed-deck-meta">{next.publicationName}</div>
            <h2 className="feed-deck-subject">{next.subject || "(No subject)"}</h2>
          </article>
        )}

        <article
          className="feed-deck-card feed-deck-card-front"
          data-feed-item-id={current.id}
          style={{
            transform: cardTransform,
            opacity: exiting ? 0 : 1,
            transition: drag ? "none" : `transform ${EXIT_MS}ms ease-out, opacity ${EXIT_MS}ms ease-out`,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="feed-deck-hints" aria-hidden="true">
            <span className="feed-deck-hint hint-save" style={{ opacity: saveHint }}>
              Save
            </span>
            <span className="feed-deck-hint hint-read" style={{ opacity: readHint }}>
              Read
            </span>
            <span className="feed-deck-hint hint-open" style={{ opacity: openHint }}>
              Open
            </span>
            <span className="feed-deck-hint hint-skip" style={{ opacity: skipHint }}>
              Skip
            </span>
          </div>

          <div className="feed-deck-meta">
            <span
              className={current.sourceKind === "rss" ? categoryToneClass(current.category) : "category-tone-news"}
              style={{
                display: "inline-block",
                width: 7,
                height: 7,
                borderRadius: 999,
                background: isRead ? "transparent" : "var(--tone-border, var(--accent-blue))",
                border: isRead ? "1px solid var(--faint)" : "none",
                marginRight: 8,
              }}
            />
            {current.publicationName} - {formatDateTime(current.date)}
          </div>

          {current.sourceKind === "rss" && current.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="feed-deck-image" src={current.imageUrl} alt="" draggable={false} />
          )}

          <h2 className="feed-deck-subject">
            {rankReason && (
              <span
                className="rank-reason-icon"
                data-tooltip={rankReason}
                aria-label={`Why recommended: ${rankReason}`}
                tabIndex={0}
              >
                i
              </span>
            )}
            {current.subject || "(No subject)"}
          </h2>

          {current.snippet && <p className="feed-deck-snippet">{summarizeSnippet(current.snippet, 320)}</p>}

          <p className="feed-deck-swipe-legend" aria-hidden="true">
            ← Mark read · Save → · ↑ Open · ↓ Skip
          </p>
        </article>
      </div>

      {/* Every gesture also has a button: nothing here is gesture-only. */}
      <div className="feed-deck-actions">
        {onToggleSaved && (
          <button
            type="button"
            className="feed-item-action-btn feed-item-action-btn-saved"
            aria-pressed={isSaved}
            onClick={() => flyOut("right", current.id)}
          >
            {isSaved ? "Saved" : "Save for later"}
          </button>
        )}
        <button type="button" className="feed-item-action-btn" onClick={() => flyOut("left", current.id)}>
          {isRead ? "Next (read)" : "Mark read"}
        </button>
        <button type="button" className="feed-item-action-btn" onClick={() => openItem(current.id)}>
          Open
        </button>
        {current.externalUrl && (
          <button
            type="button"
            className="feed-item-action-btn"
            onClick={() => openExternal(current.externalUrl as string)}
          >
            Full article
          </button>
        )}
        {onDelete && current.sourceKind === "rss" && (
          <button type="button" className="feed-item-action-btn" onClick={() => onDelete(current.id)}>
            Delete
          </button>
        )}
        <button type="button" className="feed-item-action-btn" onClick={() => flyOut("down", current.id)}>
          Skip
        </button>
        <button
          type="button"
          className="feed-item-action-btn"
          onClick={() => setIndex(retreatIndex)}
          disabled={index === 0}
        >
          Back
        </button>
      </div>

      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
    </section>
  );
}
