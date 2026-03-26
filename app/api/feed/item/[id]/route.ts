import { google, gmail_v1 } from "googleapis";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { extractArticleContent } from "@/lib/article-extract";
import { parseFrom } from "@/lib/email";
import { getHeader } from "@/lib/newsletter-classifier";

function b64urlDecode(input: string) {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, "base64").toString("utf-8");
}

function extractBodies(
  payload: gmail_v1.Schema$MessagePart | undefined
): { html?: string; text?: string } {
  let html: string | undefined;
  let text: string | undefined;

  const walk = (part: gmail_v1.Schema$MessagePart | undefined) => {
    if (!part) return;

    const mime = part.mimeType;
    const data = part.body?.data;

    if (data && (mime === "text/html" || mime === "text/plain")) {
      const decoded = b64urlDecode(data);
      if (mime === "text/html") html = html ?? decoded;
      if (mime === "text/plain") text = text ?? decoded;
    }

    if (Array.isArray(part.parts)) {
      for (const childPart of part.parts) walk(childPart);
    }
  };

  walk(payload);
  return { html, text };
}

function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

async function getGmailItem(id: string, accessToken: string) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const msg = await gmail.users.messages.get({ userId: "me", id, format: "full" });
  const payload = msg.data.payload;
  const headers = payload?.headers;
  const subject = getHeader(headers, "Subject");
  const from = getHeader(headers, "From");
  const date = getHeader(headers, "Date");
  const { html, text } = extractBodies(payload);
  const extractedText = html
    ? (await extractArticleContent(html)).text
    : cleanText(text ?? msg.data.snippet ?? "");
  const publication = parseFrom(from);

  return {
    id: msg.data.id,
    threadId: msg.data.threadId,
    subject,
    from,
    date,
    snippet: msg.data.snippet,
    hasHtml: Boolean(html),
    hasText: Boolean(extractedText),
    html,
    text: extractedText,
    externalUrl: null,
    sourceKind: "gmail" as const,
    publicationName: publication.name,
  };
}

const PAYWALLED_DOMAINS = new Set([
  "wsj.com",
  "www.wsj.com",
  "nytimes.com",
  "www.nytimes.com",
  "theatlantic.com",
  "www.theatlantic.com",
  "foreignaffairs.com",
  "www.foreignaffairs.com",
  "ft.com",
  "www.ft.com",
  "bloomberg.com",
  "www.bloomberg.com",
  "economist.com",
  "www.economist.com",
]);

// Minimum extracted text length to consider a proxy fetch successful.
const MIN_TEXT_LENGTH = 500;

function isPaywalled(url: string): boolean {
  try {
    return PAYWALLED_DOMAINS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

// Returns proxy URLs to attempt in order before falling back to the direct URL.
// archive.ph and archive.fo are the same underlying service (archive.today);
// removepaywalls.com/3/ and /5/ are their own proxy endpoints that sometimes
// succeed when the archive misses a recent article.
function paywallProxyUrls(articleUrl: string): string[] {
  const enc = encodeURIComponent(articleUrl);
  return [
    `https://archive.ph/newest/${articleUrl}`,
    `https://archive.fo/newest/${articleUrl}`,
    `https://removepaywalls.com/3/${enc}`,
    `https://removepaywalls.com/5/${enc}`,
  ];
}

async function fetchArticleHtml(
  articleUrl: string,
  paywalled: boolean
): Promise<{ html: string; text: string } | null> {
  const candidates = paywalled
    ? [...paywallProxyUrls(articleUrl), articleUrl]
    : [articleUrl];

  for (const fetchUrl of candidates) {
    try {
      const res = await fetch(fetchUrl, {
        headers: { "User-Agent": "newsletter-reader/1.0" },
        redirect: "follow",
      });
      if (!res.ok) continue;

      const fetchedHtml = await res.text();
      // Pass the original article URL to Readability so relative links resolve correctly
      const extracted = await extractArticleContent(fetchedHtml, articleUrl);
      if (extracted.text.length >= MIN_TEXT_LENGTH) {
        return { html: extracted.html || fetchedHtml, text: extracted.text };
      }
    } catch {
      // proxy unavailable or timed out — try next
    }
  }
  return null;
}

async function getRssItem(userId: string, rawId: string) {
  const rssItemId = rawId.replace(/^rss:/, "");
  const item = await prisma.rssItem.findUnique({
    where: { id: rssItemId },
    include: { source: true },
  });
  if (!item) return null;

  const sub = await prisma.userRssSubscription.findUnique({
    where: { userId_rssSourceId: { userId, rssSourceId: item.rssSourceId } },
    select: { id: true, isActive: true },
  });
  if (!sub?.isActive) return null;

  let html = item.htmlRaw ?? undefined;
  let text = item.textExtracted ?? "";

  if (!html && !text && item.link) {
    const fetched = await fetchArticleHtml(item.link, isPaywalled(item.link));
    if (fetched) {
      html = fetched.html;
      text = fetched.text;
      await prisma.rssItem.update({
        where: { id: item.id },
        data: { htmlRaw: html, textExtracted: text },
      });
    }
  }

  return {
    id: `rss:${item.id}`,
    sourceId: item.source.id,
    threadId: null,
    subject: item.title,
    from: item.author ?? item.source.name,
    date: (item.publishedAt ?? item.createdAt).toISOString(),
    snippet: item.snippet ?? "",
    hasHtml: Boolean(html),
    hasText: Boolean(text),
    html: html ?? undefined,
    text: text || undefined,
    externalUrl: item.link ?? null,
    sourceKind: "rss" as const,
    publicationName: item.source.name,
  };
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
    select: { id: true },
  });

  const url = new URL(req.url);
  const rawId = url.pathname.split("/").filter(Boolean).pop();
  if (!rawId) return NextResponse.json({ error: "Missing id in path" }, { status: 400 });

  let id = rawId;
  for (let i = 0; i < 2; i++) {
    try {
      const decoded = decodeURIComponent(id);
      if (decoded === id) break;
      id = decoded;
    } catch {
      break;
    }
  }

  if (id.startsWith("rss:")) {
    const data = await getRssItem(user.id, id);
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  }

  const accessToken = session?.accessToken as string | undefined;
  if (!accessToken) {
    return NextResponse.json({ error: "Missing Gmail access token" }, { status: 401 });
  }

  const data = await getGmailItem(id, accessToken);
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
    select: { id: true },
  });

  const url = new URL(req.url);
  const rawId = url.pathname.split("/").filter(Boolean).pop();
  if (!rawId) return NextResponse.json({ error: "Missing id in path" }, { status: 400 });

  let id = rawId;
  for (let i = 0; i < 2; i++) {
    try {
      const decoded = decodeURIComponent(id);
      if (decoded === id) break;
      id = decoded;
    } catch {
      break;
    }
  }

  if (!id.startsWith("rss:")) {
    return NextResponse.json(
      { error: "Only RSS items can be deleted from the local database" },
      { status: 400 }
    );
  }

  const rssItemId = id.replace(/^rss:/, "");
  const item = await prisma.rssItem.findUnique({
    where: { id: rssItemId },
    select: { id: true, rssSourceId: true },
  });
  if (!item) return NextResponse.json({ ok: true, deleted: false });

  const sub = await prisma.userRssSubscription.findUnique({
    where: { userId_rssSourceId: { userId: user.id, rssSourceId: item.rssSourceId } },
    select: { id: true, isActive: true },
  });
  if (!sub?.isActive) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.$transaction([
    prisma.messageReadStat.deleteMany({
      where: {
        userId: user.id,
        messageExternalId: id,
      },
    }),
    prisma.rssItem.delete({ where: { id: rssItemId } }),
  ]);

  return NextResponse.json({ ok: true, deleted: true });
}
