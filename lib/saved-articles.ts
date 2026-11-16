import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { normalizeText } from "@/lib/article-extract";
import type { FeedItem } from "@/lib/rss-candidates";
import { canonicalizeUrl, countWords, hostLabel, isFetchableUrl } from "@/lib/saved-article-helpers";

export const WEB_ID_PREFIX = "web:";
const MAX_HTML_BYTES = 6 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12000;

export class SaveError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type Extracted = {
  title: string | null;
  siteName: string | null;
  author: string | null;
  excerpt: string | null;
  imageUrl: string | null;
  html: string | null;
  text: string;
};

/** Readability + page metadata (og:title, og:image, etc.). */
async function extract(html: string, url: string): Promise<Extracted> {
  const [{ Readability }, { JSDOM }] = await Promise.all([import("@mozilla/readability"), import("jsdom")]);
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;
  const meta = (sel: string) => doc.querySelector(sel)?.getAttribute("content")?.trim() || null;
  const ogTitle = meta('meta[property="og:title"]') ?? meta('meta[name="twitter:title"]');
  const ogImage = meta('meta[property="og:image"]') ?? meta('meta[name="twitter:image"]');
  const ogSite = meta('meta[property="og:site_name"]');
  const article = new Readability(doc).parse();
  const text = normalizeText(article?.textContent ?? "");
  return {
    title: ogTitle || article?.title?.trim() || doc.title?.trim() || null,
    siteName: article?.siteName?.trim() || ogSite || hostLabel(url),
    author: article?.byline?.trim() || meta('meta[name="author"]'),
    excerpt: article?.excerpt?.trim() || meta('meta[name="description"]'),
    imageUrl: ogImage,
    html: article?.content?.trim() || null,
    text,
  };
}

async function fetchPage(url: string): Promise<string> {
  if (!isFetchableUrl(url)) throw new SaveError("That address can't be fetched", 400);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // A browser-ish UA gets the real article from more sites than a bot UA.
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) throw new SaveError(`The site answered ${res.status}`, 502);
    if (res.url && !isFetchableUrl(res.url)) throw new SaveError("Redirected to an internal address", 400);
    const type = res.headers.get("content-type") ?? "";
    if (!/html|xml/i.test(type)) throw new SaveError(`Not a web page (${type || "unknown type"})`, 415);
    return await res.text();
  } catch (error) {
    if (error instanceof SaveError) throw error;
    throw new SaveError(`Couldn't fetch the page: ${(error as Error).message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Save a link for later. If `html` is given (bookmarklet / iOS Shortcut
 * running in your logged-in browser) it is used as-is, which is how
 * paywalled articles you can see get saved in full. Otherwise the server
 * fetches the page, which works for open sites only.
 */
export async function saveArticle(input: {
  userId: string;
  url: string;
  html?: string | null;
  title?: string | null;
  via: string;
}) {
  const url = canonicalizeUrl(input.url);
  if (!url) throw new SaveError("That doesn't look like a web link", 400);
  if (input.html && Buffer.byteLength(input.html) > MAX_HTML_BYTES) {
    throw new SaveError("Page is too large to save", 413);
  }

  const pageHtml = input.html || (await fetchPage(url));
  const extracted = await extract(pageHtml, url);
  const title = extracted.title || input.title?.trim() || hostLabel(url);

  const data = {
    title: title.slice(0, 500),
    siteName: extracted.siteName,
    author: extracted.author?.slice(0, 200) ?? null,
    excerpt: extracted.excerpt?.slice(0, 1000) ?? null,
    imageUrl: extracted.imageUrl,
    html: extracted.html,
    text: extracted.text || null,
    wordCount: countWords(extracted.text),
    savedVia: input.via,
  };

  // Re-saving upgrades the stored copy only when the new one has more text:
  // a logged-in save after a teaser-only save wins, but a later teaser-only
  // re-share never clobbers a full copy.
  const existing = await prisma.savedArticle.findUnique({
    where: { userId_url: { userId: input.userId, url } },
    select: { wordCount: true },
  });
  const article = await prisma.savedArticle.upsert({
    where: { userId_url: { userId: input.userId, url } },
    update: existing && existing.wordCount >= data.wordCount ? { savedVia: input.via } : data,
    create: { userId: input.userId, url, ...data },
  });

  // Saved links live in the Saved list until finished, like anything saved.
  const messageExternalId = `${WEB_ID_PREFIX}${article.id}`;
  await prisma.messageReadStat.upsert({
    where: { userId_messageExternalId: { userId: input.userId, messageExternalId } },
    update: { savedAt: new Date(), messageTitle: data.title, sourceKind: "web", publicationName: data.siteName },
    create: {
      userId: input.userId,
      messageExternalId,
      savedAt: new Date(),
      messageTitle: data.title,
      sourceKind: "web",
      publicationName: data.siteName,
    },
  });

  return { id: messageExternalId, title: article.title, siteName: article.siteName, wordCount: article.wordCount, url };
}

export async function getSavedArticleFeed(userId: string, limit = 300): Promise<FeedItem[]> {
  const rows = await prisma.savedArticle.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, url: true, title: true, siteName: true, author: true, excerpt: true, imageUrl: true, createdAt: true },
  });
  return rows.map((row) => ({
    id: `${WEB_ID_PREFIX}${row.id}`,
    sourceKind: "web" as const,
    subject: row.title,
    from: row.author ?? row.siteName ?? hostLabel(row.url),
    date: row.createdAt.toISOString(),
    snippet: row.excerpt ?? "",
    publicationName: row.siteName ?? hostLabel(row.url),
    publicationKey: `web:${hostLabel(row.url)}`,
    externalUrl: row.url,
    imageUrl: row.imageUrl ?? undefined,
  }));
}

export async function getSavedArticleItem(userId: string, id: string) {
  const row = await prisma.savedArticle.findFirst({ where: { id: id.slice(WEB_ID_PREFIX.length), userId } });
  if (!row) return null;
  return {
    id,
    threadId: null,
    subject: row.title,
    from: row.author ?? row.siteName ?? hostLabel(row.url),
    date: row.createdAt.toISOString(),
    snippet: row.excerpt ?? "",
    hasHtml: Boolean(row.html),
    hasText: Boolean(row.text),
    html: row.html ?? undefined,
    text: row.text ?? undefined,
    externalUrl: row.url,
    sourceKind: "web" as const,
    publicationName: row.siteName ?? hostLabel(row.url),
  };
}

/** Personal token for saving from outside the app (bookmarklet, iOS Shortcut). */
export async function getOrCreateSaveToken(userId: string, rotate = false): Promise<string> {
  if (!rotate) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { saveToken: true } });
    if (user.saveToken) return user.saveToken;
  }
  const token = randomBytes(24).toString("base64url");
  await prisma.user.update({ where: { id: userId }, data: { saveToken: token } });
  return token;
}

export async function findUserIdBySaveToken(token: string | null | undefined): Promise<string | null> {
  if (!token || token.length < 20) return null;
  const user = await prisma.user.findUnique({ where: { saveToken: token }, select: { id: true } });
  return user?.id ?? null;
}
