export type DigestItem = {
  title: string;
  sourceName: string;
  snippet: string;
  externalUrl: string | null;
};

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

// RSS titles/snippets are untrusted text and get inlined into HTML, so escape
// the five markup-significant characters to prevent broken layout or injected
// tags/styles in the email.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Only allow http(s) links through to href; anything else (javascript:, data:,
// mailto:, malformed) is treated as "no link" so the title renders as plain text.
function safeHttpUrl(url: string | null): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

// Palette mirrors the app (app/globals.css light theme): --surface-muted page
// background, --accent-blue/--accent-purple header gradient, --pill-sky source
// tags, --surface-accent number badges. Email clients don't support CSS
// variables, so the values are inlined here.
const COLORS = {
  page: "#f7f9ff",
  card: "#ffffff",
  border: "#e5e7eb",
  text: "#1f2933",
  muted: "#6b7280",
  accent: "#6b8afd",
  accentDeep: "#4a63c9",
  accentSoft: "#eef2ff",
  skyBg: "#eef7ff",
  skyBorder: "#c8e0ff",
  skyText: "#3f6ea6",
} as const;

export function buildEmailHtml(items: DigestItem[], now: Date = new Date()): string {
  const rows = items
    .map((item, index) => {
      const href = safeHttpUrl(item.externalUrl);
      const title = escapeHtml(item.title);
      const titleCell = href
        ? `<a href="${escapeHtml(href)}" style="color:${COLORS.text};text-decoration:none;">${title}</a>`
        : title;
      const readLink = href
        ? `<div style="margin-top:8px;"><a href="${escapeHtml(href)}" style="font-size:12px;font-weight:600;color:${COLORS.accentDeep};text-decoration:none;">Read article &rarr;</a></div>`
        : "";
      const snippet = item.snippet
        ? `<div style="font-size:13px;color:#374151;line-height:1.55;margin-top:6px;">${escapeHtml(item.snippet.slice(0, 160).trim())}…</div>`
        : "";
      return `
    <tr>
      <td valign="top" style="padding:16px 0;border-bottom:1px solid ${COLORS.accentSoft};">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td valign="top" width="34" style="padding-right:14px;">
              <div style="width:26px;height:26px;line-height:26px;text-align:center;border-radius:999px;background:${COLORS.accentSoft};color:${COLORS.accentDeep};font-size:12px;font-weight:700;">${index + 1}</div>
            </td>
            <td valign="top">
              <span style="display:inline-block;font-size:11px;font-weight:600;color:${COLORS.skyText};background:${COLORS.skyBg};border:1px solid ${COLORS.skyBorder};border-radius:999px;padding:2px 9px;margin-bottom:8px;">${escapeHtml(item.sourceName)}</span>
              <div style="font-size:15px;font-weight:600;color:${COLORS.text};line-height:1.35;">${titleCell}</div>
              ${snippet}
              ${readLink}
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
    })
    .join("");

  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${COLORS.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${COLORS.page};padding:32px 16px;">
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;margin:0 auto;background:${COLORS.card};border-radius:14px;border:1px solid ${COLORS.border};overflow:hidden;">
        <tr>
          <td bgcolor="${COLORS.accent}" style="background:${COLORS.accent};background-image:linear-gradient(135deg,#6b8afd,#9b8cf5);padding:26px 28px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#ffffff;opacity:0.85;">🐔 Cluck&#39;s Feed</div>
            <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#ffffff;margin-top:6px;">Your daily reading list</div>
            <div style="font-size:13px;color:#ffffff;opacity:0.85;margin-top:4px;">${dateLabel}</div>
          </td>
        </tr>
        <tr><td style="padding:8px 28px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">${rows}</table>
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid ${COLORS.border};background:${COLORS.page};font-size:12px;color:#9ca3af;">
          Manage your digest preferences in <a href="${escapeHtml((process.env.NEXT_PUBLIC_APP_URL ?? "") + "/rss/settings/recommendations")}" style="color:${COLORS.accentDeep};font-weight:600;text-decoration:none;">RSS settings</a>.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
