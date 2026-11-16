"use client";

import { useRef, useState, type ReactNode } from "react";

const TRIGGER_PX = 88;
/** Horizontal movement needed before we treat a touch as a swipe, not a scroll. */
const LOCK_PX = 10;

/**
 * A list row you can swipe on a phone: left = done, right = save for later.
 *
 * Pointer events (not touch events) so it also works with a mouse/trackpad
 * drag, and `touch-action: pan-y` so vertical scrolling stays native — we
 * only take over once the gesture is clearly horizontal.
 */
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
          transform: `translateX(${dx}px)`,
          transition: dragging ? "none" : "transform 180ms ease",
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
          if (dx <= -TRIGGER_PX) onDone();
          else if (dx >= TRIGGER_PX) onSave();
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
