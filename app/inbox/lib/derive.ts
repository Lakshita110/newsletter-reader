import type { EnrichedInboxItem, FeedReadStatus, GroupedInboxItems, InboxItem } from "../types";
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
  return [...map.values()].sort((a, b) => b.key.localeCompare(a.key)).slice(0, 4);
}


export type TodayWindowMode = "rolling24h" | "calendarDay" | "none";

export type ViewModeFilterArgs = {
  viewMode: "recommended" | "today" | "unread" | "saved" | "all";
  statusById: Record<string, FeedReadStatus>;
  savedById: Record<string, boolean>;
  rolling24hCutoffMs: number;
  todayWindowMode?: TodayWindowMode;
};

export function filterByViewMode(
  items: EnrichedInboxItem[],
  { viewMode, statusById, savedById, rolling24hCutoffMs, todayWindowMode = "rolling24h" }: ViewModeFilterArgs
): EnrichedInboxItem[] {
  return items.filter((item) => {
    const inRolling24h = Boolean(item._date && item._date.getTime() >= rolling24hCutoffMs);
    if (viewMode === "today") {
      if (todayWindowMode === "none") return true;
      if (todayWindowMode === "calendarDay") return item._dayKey === getRelativeKeys().todayKey;
      return inRolling24h;
    }
    if (viewMode === "recommended") return true;
    if (viewMode === "unread") return statusById[item.id] !== "read";
    if (viewMode === "saved") return savedById[item.id] === true;
    return true;
  });
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
      `${it.subject} ${it.from} ${it.publicationName} ${it.category ?? ""} ${it.snippet}`.toLowerCase();
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

export function getTodayStats(
  items: EnrichedInboxItem[],
  statusById: Record<string, FeedReadStatus>,
  opts?: { rolling24hCutoffMs?: number; todayWindowMode?: TodayWindowMode }
) {
  const todayWindowMode = opts?.todayWindowMode ?? "calendarDay";
  const todayItems =
    todayWindowMode === "rolling24h"
      ? items.filter((it) => Boolean(it._date && it._date.getTime() >= (opts?.rolling24hCutoffMs ?? 0)))
      : items.filter((it) => it._dayKey === getRelativeKeys().todayKey);
  const readToday = todayItems.filter((it) => statusById[it.id] === "read").length;
  const inProgressToday = todayItems.filter((it) => statusById[it.id] === "in-progress").length;
  return { readToday, inProgressToday, totalToday: todayItems.length };
}

export function buildDailyEdition(
  filtered: EnrichedInboxItem[],
  maxItems: number,
  showAllEarlier: boolean
) {
  const { todayKey, yesterdayKey } = getRelativeKeys();
  const sorted = [...filtered].sort((a, b) => {
    const ta = a._date?.getTime() ?? 0;
    const tb = b._date?.getTime() ?? 0;
    return tb - ta;
  });

  const today = sorted.filter((it) => it._dayKey === todayKey);
  const yesterday = sorted.filter((it) => it._dayKey === yesterdayKey);
  const earlier = sorted.filter(
    (it) => it._dayKey !== todayKey && it._dayKey !== yesterdayKey
  );

  const earlierSlots = Math.max(0, maxItems - today.length - yesterday.length);
  const visibleEarlier = showAllEarlier ? earlier : earlier.slice(0, earlierSlots);
  const hiddenEarlierCount = Math.max(0, earlier.length - visibleEarlier.length);

  const grouped: GroupedInboxItems[] = [
    { key: "today", label: "Today", items: today },
    { key: "yesterday", label: "Yesterday", items: yesterday },
    { key: "earlier", label: "Earlier", items: visibleEarlier },
  ].filter((g) => g.items.length > 0);

  return {
    grouped,
    hiddenEarlierCount,
    totalShown: today.length + yesterday.length + visibleEarlier.length,
    totalAvailable: sorted.length,
    olderIds: [...yesterday, ...earlier].map((it) => it.id),
  };
}
