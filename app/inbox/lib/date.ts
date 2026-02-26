export function parseDate(value: string): Date | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function toDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getRelativeKeys() {
  const now = new Date();
  const todayKey = toDayKey(now);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  const yesterdayKey = toDayKey(y);
  return { todayKey, yesterdayKey };
}

export function formatDayLabel(dayKey: string): string {
  const { todayKey, yesterdayKey } = getRelativeKeys();
  if (dayKey === todayKey) return "Today";
  if (dayKey === yesterdayKey) return "Yesterday";

  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

export function formatDayPillLabel(dayKey: string): string {
  const { todayKey, yesterdayKey } = getRelativeKeys();
  if (dayKey === todayKey) return "Today";
  if (dayKey === yesterdayKey) return "Yesterday";

  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const sameYear = parsed.getFullYear() === new Date().getFullYear();
  const date = parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  const time = parsed.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}
