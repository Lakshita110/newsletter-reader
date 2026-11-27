import type { FeedReadStatus } from "@/app/lib/feed-types";

/**
 * Read/save changes made on this device, newest last, with when they were
 * made. Kept in module memory, so it survives client-side navigation between
 * Today and the reader (one page lifetime).
 *
 * Why: Today and the reader fetch the server's read state and *replace* their
 * local maps with it. That GET can be slow (Today's load waits on mail sync
 * and feed refresh), so a "done" tapped while it was in flight was wiped out
 * by the older snapshot when it landed, and the item came back. Pages now
 * note when their fetch started and re-apply every edit the snapshot may not
 * include: one still being saved, or one the server confirmed after the fetch
 * started (e.g. "Done" in the reader, then straight back to Today).
 */
type LocalEdit = {
  id: string;
  at: number;
  /** When the server acknowledged it; unset while the request is in flight. */
  confirmedAt?: number;
  status?: FeedReadStatus | null;
  saved?: boolean;
};
const localEdits: LocalEdit[] = [];
const MAX_EDITS = 500;

/** Clock for edits; injectable in tests. */
let now = () => Date.now();
export function setReadStateClockForTests(clock: () => number) {
  now = clock;
}
export function clearLocalEditsForTests() {
  localEdits.length = 0;
}

function editFor(state: string): Omit<LocalEdit, "id" | "at"> | null {
  switch (state) {
    case "read":
    case "dismissed":
      return { status: "read" };
    case "unread":
      return { status: null };
    case "in_progress":
      return { status: "in-progress" };
    case "saved":
      return { saved: true };
    case "unsaved":
      return { saved: false };
    // "opened" only records a visit; it never changes what Today shows.
    default:
      return null;
  }
}

function recordLocalEdits(payload: Record<string, unknown>): LocalEdit[] {
  const state = typeof payload.state === "string" ? payload.state : "";
  const edit = editFor(state);
  if (!edit) return [];
  const ids = Array.isArray(payload.messageIds)
    ? payload.messageIds.filter((id): id is string => typeof id === "string")
    : typeof payload.messageId === "string"
      ? [payload.messageId]
      : [];
  const at = now();
  const added = ids.map((id) => ({ id, at, ...edit }));
  localEdits.push(...added);
  if (localEdits.length > MAX_EDITS) localEdits.splice(0, localEdits.length - MAX_EDITS);
  return added;
}

/** A change the server never stored must not keep overriding what it says. */
function forgetLocalEdits(edits: LocalEdit[]) {
  for (const edit of edits) {
    const index = localEdits.indexOf(edit);
    if (index >= 0) localEdits.splice(index, 1);
  }
}

/** Use as the start mark of a read-state fetch, for applyLocalEditsSince. */
export function readStateClock(): number {
  return now();
}

/**
 * Re-apply this device's edits that a server snapshot requested at `since`
 * might be missing (still in flight, or confirmed after `since`), in the order
 * they were made. Returns new maps; inputs are untouched.
 */
export function applyLocalEditsSince(
  since: number,
  status: Record<string, FeedReadStatus>,
  saved: Record<string, boolean>
): { status: Record<string, FeedReadStatus>; saved: Record<string, boolean> } {
  const nextStatus = { ...status };
  const nextSaved = { ...saved };
  for (const edit of localEdits) {
    if (edit.confirmedAt !== undefined && edit.confirmedAt < since) continue;
    if (edit.status === null) delete nextStatus[edit.id];
    else if (edit.status) nextStatus[edit.id] = edit.status;
    if (edit.saved === true) nextSaved[edit.id] = true;
    else if (edit.saved === false) delete nextSaved[edit.id];
  }
  return { status: nextStatus, saved: nextSaved };
}

/**
 * Record a read/save state change. Throws on a non-2xx response so callers'
 * `.catch` handlers actually see failures instead of the change silently not
 * persisting.
 */
export async function postReadState(payload: Record<string, unknown>) {
  const edits = recordLocalEdits(payload);
  try {
    const res = await fetch("/api/read-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`read-state ${res.status}`);
    const confirmedAt = now();
    for (const edit of edits) edit.confirmedAt = confirmedAt;
  } catch (error) {
    forgetLocalEdits(edits);
    throw error;
  }
}
