"use client";

import { useCallback, useSyncExternalStore } from "react";

export type UiMode = "list" | "cards";

const STORAGE_KEY = "nr_ui_mode";

// Coarse pointer OR narrow viewport — a phone qualifies on both, a touch
// laptop on one. Matches the existing `(hover: none), (pointer: coarse)`
// override in globals.css rather than inventing a new breakpoint scheme.
const MOBILE_QUERY = "(max-width: 640px), (pointer: coarse)";

// localStorage and matchMedia are external stores, so they're read through
// useSyncExternalStore rather than an effect-writes-state dance. That gets us
// the SSR snapshot for free (no hydration mismatch) and keeps the value in
// sync across every component that reads it — including two inbox pages and
// the header toggle — without a context.

const uiModeListeners = new Set<() => void>();

function subscribeUiMode(onChange: () => void): () => void {
  uiModeListeners.add(onChange);
  // Catches changes made in another tab; same-tab writes notify directly.
  window.addEventListener("storage", onChange);
  return () => {
    uiModeListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getUiModeSnapshot(): UiMode {
  return window.localStorage.getItem(STORAGE_KEY) === "cards" ? "cards" : "list";
}

/** Server and first client render agree on "list" — we never auto-flip a user. */
function getUiModeServerSnapshot(): UiMode {
  return "list";
}

/**
 * Persisted card/list preference. Deliberately defaults to "list" on every
 * device — existing users are never silently moved into the new UI, they opt
 * in via the toggle and the choice sticks.
 */
export function useUiMode(): [UiMode, (mode: UiMode) => void] {
  const uiMode = useSyncExternalStore(subscribeUiMode, getUiModeSnapshot, getUiModeServerSnapshot);

  const setUiMode = useCallback((mode: UiMode) => {
    window.localStorage.setItem(STORAGE_KEY, mode);
    for (const listener of uiModeListeners) listener();
  }, []);

  return [uiMode, setUiMode];
}

function subscribeMobileViewport(onChange: () => void): () => void {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getMobileViewportSnapshot(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function getMobileViewportServerSnapshot(): boolean {
  return false;
}

export function useIsMobileViewport(): boolean {
  return useSyncExternalStore(
    subscribeMobileViewport,
    getMobileViewportSnapshot,
    getMobileViewportServerSnapshot
  );
}

export function UiModeToggle({
  uiMode,
  onChange,
}: {
  uiMode: UiMode;
  onChange: (mode: UiMode) => void;
}) {
  return (
    <div className="ui-mode-toggle" role="group" aria-label="Feed layout">
      <button
        type="button"
        className={uiMode === "list" ? "ui-mode-btn active" : "ui-mode-btn"}
        aria-pressed={uiMode === "list"}
        onClick={() => onChange("list")}
        title="List view"
      >
        List
      </button>
      <button
        type="button"
        className={uiMode === "cards" ? "ui-mode-btn active" : "ui-mode-btn"}
        aria-pressed={uiMode === "cards"}
        onClick={() => onChange("cards")}
        title="Swipe card view"
      >
        Cards
      </button>
    </div>
  );
}
