import type { InboxItem } from "../types";

type ReadContext = { title: string; sourceKind: "gmail" | "rss"; publicationName: string };

export function buildContextById(
  items: InboxItem[],
  fallbackKind: "gmail" | "rss"
): Record<string, ReadContext> {
  const next: Record<string, ReadContext> = {};
  for (const item of items) {
    next[item.id] = {
      title: item.subject || "(No subject)",
      sourceKind: item.sourceKind ?? fallbackKind,
      publicationName: item.publicationName,
    };
  }
  return next;
}

export async function postReadState(payload: Record<string, unknown>) {
  await fetch("/api/read-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
