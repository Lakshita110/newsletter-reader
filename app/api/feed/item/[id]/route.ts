import { google, gmail_v1 } from "googleapis";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { extractArticleContent } from "@/lib/article-extract";

function b64urlDecode(input: string) {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, "base64").toString("utf-8");
}

function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  const header = headers?.find(
    (candidate) => candidate.name?.toLowerCase() === name.toLowerCase()
  );
  return header?.value ?? "";
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
  };
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
    try {
      const res = await fetch(item.link, { headers: { "User-Agent": "newsletter-reader/1.0" } });
      if (res.ok) {
        const fetchedHtml = await res.text();
        const extracted = await extractArticleContent(fetchedHtml, item.link);
        html = extracted.html || fetchedHtml;
        text = extracted.text;
        await prisma.rssItem.update({
          where: { id: item.id },
          data: { htmlRaw: html, textExtracted: text || null },
        });
      }
    } catch {
      // fall through to external link fallback
    }
  }

  return {
    id: `rss:${item.id}`,
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

