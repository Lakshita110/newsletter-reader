"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const FONT_SIZES = [15, 17, 19, 21];

export function useReaderFontSize() {
  const [size, setSize] = useState(() => {
    if (typeof window === "undefined") return 17;
    const stored = Number(window.localStorage.getItem("nr_reader_font"));
    return FONT_SIZES.includes(stored) ? stored : 17;
  });
  const cycle = () => {
    const next = FONT_SIZES[(FONT_SIZES.indexOf(size) + 1) % FONT_SIZES.length];
    setSize(next);
    window.localStorage.setItem("nr_reader_font", String(next));
  };
  return [size, cycle] as const;
}

/**
 * Thumb-reach controls for reading on a phone. Hides while scrolling down
 * (more text on screen) and comes back on any upward scroll, like Safari.
 */
export function ReaderToolbar({
  backHref,
  isSaved,
  onToggleSaved,
  onDone,
  doneLabel,
  externalUrl,
  onCycleFont,
}: {
  backHref: string;
  isSaved: boolean;
  onToggleSaved: () => void;
  onDone: () => void;
  doneLabel: string;
  externalUrl?: string | null;
  onCycleFont: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const nearBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 40;
      if (nearBottom) setHidden(false);
      else if (y > lastY.current + 8 && y > 120) setHidden(true);
      else if (y < lastY.current - 8) setHidden(false);
      lastY.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`reader-toolbar${hidden ? " hidden" : ""}`} aria-label="Reader actions">
      <Link href={backHref} aria-label="Back to list">
        ← Back
      </Link>
      <button type="button" onClick={onCycleFont} aria-label="Change text size">
        Aa
      </button>
      <button type="button" onClick={onToggleSaved} className={isSaved ? "on" : ""} aria-pressed={isSaved}>
        {isSaved ? "Saved" : "Save"}
      </button>
      {externalUrl ? (
        <a href={externalUrl} target="_blank" rel="noopener noreferrer" aria-label="Open original">
          Web ↗
        </a>
      ) : null}
      <button type="button" className="primary" onClick={onDone}>
        {doneLabel}
      </button>
    </nav>
  );
}
