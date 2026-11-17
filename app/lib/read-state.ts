/**
 * Record a read/save state change. Throws on a non-2xx response so callers'
 * `.catch` handlers actually see failures instead of the change silently not
 * persisting.
 */
export async function postReadState(payload: Record<string, unknown>) {
  const res = await fetch("/api/read-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`read-state ${res.status}`);
}
