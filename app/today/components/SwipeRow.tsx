"use client";

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";

const TRIGGER_PX = 88;
/** How long the row takes to slide off screen before it's removed from the list. */
const FLY_MS = 180;
const HINT_KEY = "nr_swipe_hint_seen";
/** Horizontal movement needed before we treat a touch as a swipe, not a scroll. */
const LOCK_PX = 10;

/**
 * A list row you can swipe on a phone: left = done, right = save for later.
 *
 * Pointer events (not touch events) so it also works with a mouse/trackpad
 * drag, and `touch-action: pan-y` so vertical scrolling stays native — we
 * only take over once the gesture is clearly horizontal.
 */
/** A completed swipe: buzz (Android only; iOS has no vibrate API) and retire the hint. */
function swiped() {
  navigator.vibrate?.(10);
  try {
    window.localStorage.setItem(HINT_KEY, "1");
  } catch (error) {
    console.warn("[swipe] could not remember the hint was seen", error);
  }
  window.dispatchEvent(new Event(HINT_KEY));
}

function hintSeen(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return true; // storage blocked: don't nag every visit
  }
}

function subscribeHint(onChange: () => void) {
  window.addEventListener(HINT_KEY, onChange);
  return () => window.removeEventListener(HINT_KEY, onChange);
}

/**
 * One-line "how to swipe" note for touch screens, gone after the first swipe.
 * useSyncExternalStore with a server snapshot of "seen" keeps SSR and the
 * first client render identical (no hydration mismatch), then reads storage.
 */
export function SwipeHint() {
  const seen = useSyncExternalStore(subscribeHint, hintSeen, () => true);
  if (seen) return null;
  return <p className="swipe-hint">Swipe left to dismiss, right to save.</p>;
}

export function SwipeRow({
  children,
  onDone,
  onSave,
  saveLabel = "Save",
}: {
  children: ReactNode;
  onDone: () => void;
  onSave: () => void;
  saveLabel?: string;
}) {
  const [dx, setDx] = useState(0);
  // Set while a dismissed row slides off. Removing it from the list right away
  // made it snap back and then vanish, which read as "the swipe didn't work".
  const [flying, setFlying] = useState(false);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const locked = useRef<"x" | "y" | null>(null);
  const didSwipe = useRef(false);

  const reset = () => {
    start.current = null;
    locked.current = null;
    setDragging(false);
    setDx(0);
  };

  return (
    <div className="swipe-row">
      <div className={`swipe-bg ${dx > 0 ? "swipe-bg-save" : "swipe-bg-done"}`} aria-hidden>
        <span>{dx > 0 ? saveLabel : ""}</span>
        <span>{dx < 0 ? "Done" : ""}</span>
      </div>
      <div
        className="swipe-fg"
        style={{
          transform: flying ? "translateX(-110%)" : `translateX(${dx}px)`,
          transition: dragging ? "none" : `transform ${FLY_MS}ms ease`,
        }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          start.current = { x: e.clientX, y: e.clientY };
          locked.current = null;
          didSwipe.current = false;
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const mx = e.clientX - start.current.x;
          const my = e.clientY - start.current.y;
          if (!locked.current) {
            if (Math.abs(mx) > LOCK_PX && Math.abs(mx) > Math.abs(my)) {
              locked.current = "x";
              setDragging(true);
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            } else if (Math.abs(my) > LOCK_PX) {
              locked.current = "y";
            }
          }
          if (locked.current === "x") {
            didSwipe.current = true;
            setDx(Math.max(-160, Math.min(160, mx)));
          }
        }}
        onPointerUp={() => {
          if (dx <= -TRIGGER_PX) {
            swiped();
            setDragging(false);
            setFlying(true);
            window.setTimeout(() => {
              onDone();
              // If the row stays (e.g. the parent keeps it), bring it back.
              setFlying(false);
              reset();
            }, FLY_MS);
            return;
          }
          if (dx >= TRIGGER_PX) {
            swiped();
            onSave();
          }
          reset();
        }}
        onPointerCancel={reset}
        // Swallow the click that follows a swipe so it doesn't open the item.
        onClickCapture={(e) => {
          if (didSwipe.current) {
            e.preventDefault();
            e.stopPropagation();
            didSwipe.current = false;
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
