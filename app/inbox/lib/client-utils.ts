import type { FeedReadStatus } from "../types";

export function isTypingTarget(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node) return false;
  return node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable;
}

export function escapeSelectorValue(value: string): string {
  if (typeof window !== "undefined" && window.CSS?.escape) return window.CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

export function readMapFromStorage<T>(key: string): Record<string, T> {
  if (typeof window === "undefined") return {};
  const stored = window.localStorage.getItem(key);
  if (!stored) return {};
  try {
    const parsed = JSON.parse(stored) as Record<string, T>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveMapToStorage(key: string, value: Record<string, unknown>) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function toReadStatusMap(data: unknown): Record<string, FeedReadStatus> {
  const next: Record<string, FeedReadStatus> = {};
  const payload = (data && typeof data === "object" ? data : {}) as {
    readIds?: unknown[];
    inProgressIds?: unknown[];
  };
  for (const id of payload.inProgressIds ?? []) {
    if (typeof id === "string") next[id] = "in-progress";
  }
  for (const id of payload.readIds ?? []) {
    if (typeof id === "string") next[id] = "read";
  }
  return next;
}

export function toSavedMap(data: unknown): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  const payload = (data && typeof data === "object" ? data : {}) as {
    savedIds?: unknown[];
  };
  for (const id of payload.savedIds ?? []) {
    if (typeof id === "string") next[id] = true;
  }
  return next;
}
