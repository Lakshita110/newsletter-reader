export type DigestItem = {
  title: string;
  sourceName: string;
  snippet: string;
  externalUrl: string | null;
};

/**
 * Current hour (0-23) in the given IANA timezone, or -1 if the timezone is
 * invalid. Used to decide whether it's a given user's configured digest hour.
 */
export function getCurrentHourInTimezone(tz: string, now: Date = new Date()): number {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false });
    const parts = formatter.formatToParts(now);
    const hourStr = parts.find((p) => p.type === "hour")?.value;
    return hourStr ? parseInt(hourStr, 10) % 24 : -1;
  } catch {
    return -1;
  }
}

/**
 * Local date key (YYYY-MM-DD) in the given timezone. Falls back to the UTC day
 * key if the timezone is invalid, so we never lose the de-dupe guard.
 */
export function getLocalDateKey(tz: string, now: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    return formatter.format(now);
  } catch {
    // Invalid timezone — fall back to the UTC day key so the de-dupe guard
    // still works. Mirrors dayKeyUtc() in rss-helpers without importing it
    // (which would pull the Prisma client into this otherwise-pure module).
    const y = now.getUTCFullYear();
    const m = `${now.getUTCMonth() + 1}`.padStart(2, "0");
    const d = `${now.getUTCDate()}`.padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
}

/** Subject line for the digest email, pluralized for the item count. */
export function getDigestSubject(itemCount: number): string {
  const noun = itemCount === 1 ? "article" : "articles";
  return `Your daily reading list — ${itemCount} ${noun}`;
}

export function buildEmailHtml(items: DigestItem[], now: Date = new Date()): string {
  const rows = items
    .map(
      (item) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;">
        <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:4px;">
          ${item.externalUrl
            ? `<a href="${item.externalUrl}" style="color:#111827;text-decoration:none;">${item.title}</a>`
            : item.title}
        </div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">${item.sourceName}</div>
        ${item.snippet ? `<div style="font-size:13px;color:#374151;line-height:1.5;">${item.snippet.slice(0, 160).trim()}…</div>` : ""}
      </td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;padding:24px;">
        <tr><td style="padding-bottom:20px;border-bottom:1px solid #e5e7eb;">
          <div style="font-size:18px;font-weight:700;color:#111827;">Your daily reading list</div>
          <div style="font-size:13px;color:#6b7280;margin-top:4px;">${now.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}</div>
        </td></tr>
        <tr><td>
          <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
        </td></tr>
        <tr><td style="padding-top:20px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
          Manage your digest preferences in <a href="${process.env.NEXT_PUBLIC_APP_URL ?? ""}/rss/settings/recommendations" style="color:#6b7280;">RSS settings</a>.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
