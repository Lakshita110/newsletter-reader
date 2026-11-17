import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session-user";
import { findUserIdBySaveToken, saveArticle, SaveError } from "@/lib/saved-articles";

export const dynamic = "force-dynamic";
// Readability over a big page can take a few seconds.
export const maxDuration = 30;

// Token-authenticated requests come from other origins (bookmarklet on any
// site, iOS Shortcuts). They never carry cookies, so a wildcard origin is safe.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

type SaveBody = { url?: unknown; html?: unknown; title?: unknown; token?: unknown };

/**
 * Accept whatever the sender manages to produce: JSON (app, Shortcut), a
 * form post (bookmarklet), or a bare URL (Shortcut fed a share-sheet URL).
 * JSON is tried first regardless of Content-Type because Shortcuts and curl
 * are loose about the header.
 */
async function readBody(req: Request): Promise<{ body: SaveBody; isForm: boolean }> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    return { body: Object.fromEntries(form.entries()) as SaveBody, isForm: true };
  }
  const raw = await req.text();
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      return { body: JSON.parse(trimmed) as SaveBody, isForm: false };
    } catch {
      // fall through
    }
  }
  if (type.includes("application/x-www-form-urlencoded")) {
    return { body: Object.fromEntries(new URLSearchParams(raw).entries()) as SaveBody, isForm: true };
  }
  return { body: { url: trimmed }, isForm: false };
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

/** Tiny confirmation page for the bookmarklet, which opens in a new tab. */
function htmlPage(title: string, detail: string, ok: boolean) {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ok ? "Saved" : "Not saved"}</title>
<body style="font-family:system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#0F172A;color:#e6edf7;text-align:center;padding:24px">
<div><div style="font-size:42px">${ok ? "✓" : "!"}</div><h1 style="font-size:20px">${esc(title)}</h1><p style="opacity:.75">${esc(detail)}</p>
<p><a style="color:#8ab4ff" href="/today?tab=saved">Open Saved</a></p></div>
${ok ? "<script>setTimeout(()=>window.close(),1800)</script>" : ""}</body>`,
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", ...CORS } }
  );
}

export async function POST(req: Request) {
  const { body, isForm } = await readBody(req);
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const tokenUserId = await findUserIdBySaveToken(bearer || str(body.token));
  const userId = tokenUserId ?? (await getSessionUserId());
  if (!userId) {
    return isForm
      ? htmlPage("Not saved", "Your save link is out of date. Copy a fresh one from Sources.", false)
      : NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  const url = str(body.url);
  if (!url) {
    return isForm
      ? htmlPage("Not saved", "No link was sent.", false)
      : NextResponse.json({ error: "Missing url" }, { status: 400, headers: CORS });
  }

  try {
    const saved = await saveArticle({
      userId,
      url,
      html: str(body.html),
      title: str(body.title),
      via: isForm ? "bookmarklet" : tokenUserId ? "shortcut" : "app",
    });
    const detail =
      saved.wordCount > 0
        ? `${Math.max(1, Math.round(saved.wordCount / 220))} min read`
        : "Saved (no article text found)";
    return isForm ? htmlPage(saved.title, detail, true) : NextResponse.json({ ok: true, ...saved }, { headers: CORS });
  } catch (error) {
    const status = error instanceof SaveError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Save failed";
    console.error("[save] failed", { url, status, message });
    return isForm
      ? htmlPage("Not saved", message, false)
      : NextResponse.json({ error: message }, { status, headers: CORS });
  }
}
