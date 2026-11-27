"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

/** Drag this far and let go to act. */
const TRIGGER_PX = 72;
/** Or flick: a shorter drag that is still moving this fast (px/ms) when released. */
const FLICK_MIN_PX = 32;
const FLICK_SPEED = 0.3;
const MAX_DRAG_PX = 160;
/** How long the row takes to slide off screen before it's removed from the list. */
const FLY_MS = 180;
const HINT_KEY = "nr_swipe_hint_seen";
/**
 * Movement needed before we decide swipe vs scroll. Small on purpose: iOS
 * commits to scrolling on the first few pixels of a move, and once it has, a
 * row can no longer stop it.
 */
const LOCK_PX = 6;

/**
 * A list row you can swipe on a phone: left = done, right = save for later.
 *
 * Touch events, not pointer events, on touch screens. With pointer events,
 * iOS Safari cancels the gesture (pointercancel) as soon as the finger drifts
 * a little vertically and the page starts scrolling, so a swipe that wasn't
 * perfectly level snapped back and did nothing. A non-passive touchmove lets
 * us call preventDefault once the swipe is clearly horizontal, which keeps
 * the page still for the rest of it. `touch-action: pan-y` (CSS) still leaves
 * vertical scrolling native. A mouse drag uses pointer events.
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
  const fg = useRef<HTMLDivElement>(null);
  const didSwipe = useRef(false);
  // The listeners are attached once, so they read the latest callbacks from here.
  const actions = useRef({ onDone, onSave });
  useEffect(() => {
    actions.current = { onDone, onSave };
  });

  useEffect(() => {
    const el = fg.current;
    if (!el) return;
    type Gesture = {
      x: number;
      y: number;
      dx: number;
      lock: "x" | "y" | null;
      lastX: number;
      lastT: number;
      vx: number;
    };
    let g: Gesture | null = null;

    const begin = (x: number, y: number) => {
      g = { x, y, dx: 0, lock: null, lastX: x, lastT: performance.now(), vx: 0 };
      didSwipe.current = false;
    };
    /** Returns true once the gesture is a horizontal swipe. */
    const move = (x: number, y: number): boolean => {
      if (!g) return false;
      const mx = x - g.x;
      const my = y - g.y;
      if (!g.lock) {
        if (Math.abs(mx) >= LOCK_PX && Math.abs(mx) > Math.abs(my)) {
          g.lock = "x";
          setDragging(true);
        } else if (Math.abs(my) >= LOCK_PX) {
          g.lock = "y";
        }
      }
      if (g.lock !== "x") return false;
      const t = performance.now();
      if (t > g.lastT) g.vx = (x - g.lastX) / (t - g.lastT);
      g.lastX = x;
      g.lastT = t;
      g.dx = Math.max(-MAX_DRAG_PX, Math.min(MAX_DRAG_PX, mx));
      didSwipe.current = true;
      setDx(g.dx);
      return true;
    };
    const reset = () => {
      g = null;
      setDragging(false);
      setDx(0);
    };
    const end = () => {
      if (!g || g.lock !== "x") return reset();
      const { dx: d, vx } = g;
      const left = d <= -TRIGGER_PX || (d <= -FLICK_MIN_PX && vx <= -FLICK_SPEED);
      const right = d >= TRIGGER_PX || (d >= FLICK_MIN_PX && vx >= FLICK_SPEED);
      if (left) {
        g = null;
        swiped();
        setDragging(false);
        setFlying(true);
        window.setTimeout(() => {
          actions.current.onDone();
          // If the row stays (e.g. the parent keeps it), bring it back.
          setFlying(false);
          setDx(0);
        }, FLY_MS);
        return;
      }
      if (right) {
        swiped();
        actions.current.onSave();
      }
      reset();
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return reset();
      begin(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t && move(t.clientX, t.clientY) && e.cancelable) e.preventDefault();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      begin(e.clientX, e.clientY);
      const onMove = (ev: PointerEvent) => {
        if (move(ev.clientX, ev.clientY) && !el.hasPointerCapture(ev.pointerId)) el.setPointerCapture(ev.pointerId);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        end();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    // Must be non-passive, or preventDefault is ignored (see the note above).
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", reset);
    el.addEventListener("pointerdown", onPointerDown);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", reset);
      el.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return (
    <div className="swipe-row">
      <div className={`swipe-bg ${dx > 0 ? "swipe-bg-save" : "swipe-bg-done"}`} aria-hidden>
        <span>{dx > 0 ? saveLabel : ""}</span>
        <span>{dx < 0 ? "Done" : ""}</span>
      </div>
      <div
        ref={fg}
        className="swipe-fg"
        style={{
          transform: flying ? "translateX(-110%)" : `translateX(${dx}px)`,
          transition: dragging ? "none" : `transform ${FLY_MS}ms ease`,
        }}
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
