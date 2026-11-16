/** Pure helpers for "save any link", kept import-free for cheap tests. */

const TRACKING_PARAM = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|cmpid|smid|sh|s|r|triedRedirect|publication_id|post_id|isFreemail|token)$/i;

/** Drop tracking params and fragments so the same article saves once. */
export function canonicalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

/**
 * Refuse server-side fetches of internal addresses (SSRF). Only applies when
 * the server fetches the page itself; pages whose HTML the client sent are
 * never fetched.
 */
export function isFetchableUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return false;
  }
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return false;
  return true;
}

export function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Bookmarklet that posts the page you are looking at (paywall and all) to the app. */
export function buildBookmarklet(origin: string, token: string): string {
  const js = `(()=>{const f=document.createElement('form');f.method='POST';f.action=${JSON.stringify(
    `${origin}/api/save`
  )};f.target='_blank';f.acceptCharset='utf-8';const a=(n,v)=>{const i=document.createElement('input');i.type='hidden';i.name=n;i.value=v;f.appendChild(i)};a('token',${JSON.stringify(
    token
  )});a('url',location.href);a('title',document.title);a('html',document.documentElement.outerHTML);document.body.appendChild(f);f.submit();f.remove()})()`;
  return `javascript:${encodeURIComponent(js)}`;
}
