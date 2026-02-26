import type { EnrichedInboxItem, GroupedInboxItems, InboxItem } from "../types";
import { formatDayLabel, getRelativeKeys, parseDate, toDayKey } from "./date";

export function getPublications(items: InboxItem[]) {
  const map = new Map<string, { key: string; name: string; count: number }>();
  for (const it of items) {
    const k = it.publicationKey;
    if (!k) continue;
    const prev = map.get(k);
    map.set(k, {
      key: k,
      name: it.publicationName || it.from,
      count: (prev?.count ?? 0) + 1,
    });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export function enrichItems(items: InboxItem[]): EnrichedInboxItem[] {
  return items.map((it) => {
    const parsed = parseDate(it.date);
    const dayKey = parsed ? toDayKey(parsed) : "unknown";
    return { ...it, _date: parsed, _dayKey: dayKey };
  });
}

export function getDays(enriched: EnrichedInboxItem[]) {
  const map = new Map<string, { key: string; count: number }>();
  for (const it of enriched) {
    if (!it._dayKey || it._dayKey === "unknown") continue;
    const prev = map.get(it._dayKey);
    map.set(it._dayKey, {
      key: it._dayKey,
      count: (prev?.count ?? 0) + 1,
    });
  }
  return [...map.values()].sort((a, b) => b.key.localeCompare(a.key));
}

export function filterItems(
  items: EnrichedInboxItem[],
  q: string,
  selectedPub: string | null,
  selectedDay: string | null
): EnrichedInboxItem[] {
  const query = q.trim().toLowerCase();
  return items.filter((it) => {
    if (selectedPub && it.publicationKey !== selectedPub) return false;
    if (selectedDay && it._dayKey !== selectedDay) return false;
    if (!query) return true;

    const hay =
      `${it.subject} ${it.from} ${it.publicationName} ${it.snippet}`.toLowerCase();
    return hay.includes(query);
  });
}

export function groupItemsByDay(filtered: EnrichedInboxItem[]): GroupedInboxItems[] {
  const byDay = new Map<string, EnrichedInboxItem[]>();
  for (const it of filtered) {
    const key = it._dayKey || "unknown";
    const list = byDay.get(key) ?? [];
    list.push(it);
    byDay.set(key, list);
  }

  const keys = [...byDay.keys()].sort((a, b) => {
    if (a === "unknown") return 1;
    if (b === "unknown") return -1;
    return b.localeCompare(a);
  });

  return keys.map((key) => {
    const list = byDay.get(key) ?? [];
    list.sort((a, b) => {
      const ta = a._date?.getTime() ?? 0;
      const tb = b._date?.getTime() ?? 0;
      return tb - ta;
    });
    return {
      key,
      label: key === "unknown" ? "Unknown date" : formatDayLabel(key),
      items: list,
    };
  });
}

export function getTodayStats(items: EnrichedInboxItem[], readIds: Set<string>) {
  const { todayKey } = getRelativeKeys();
  const todayItems = items.filter((it) => it._dayKey === todayKey);
  const readToday = todayItems.filter((it) => readIds.has(it.id)).length;
  return { readToday, totalToday: todayItems.length };
}
