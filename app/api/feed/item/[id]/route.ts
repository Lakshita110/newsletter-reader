import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractArticleContent, normalizeText } from "@/lib/article-extract";
import { getSessionUser, getSessionUserId } from "@/lib/session-user";
import { getSavedArticleItem, WEB_ID_PREFIX } from "@/lib/saved-articles";
import { publicationNameFor } from "@/lib/newsletter-sync-helpers";

export const dynamic = "force-dynamic";

/**
 * Route params may arrive percent-encoded (sometimes doubly, via client-side
 * navigation), so decode until stable — bounded to two rounds.
 */
function decodeItemId(rawId: string): string {
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
  return id;
}

/**
 * Serve a newsletter from the DB copy when we have one: works without a
 * live Gmail token and after the email ages out or is deleted. The extracted
 * reader text is computed once and cached on the row.
 */
async function getStoredNewsletterItem(userId: string, id: string) {
  const issue = await prisma.newsletterIssue.findUnique({
    where: { userId_gmailMessageId: { userId, gmailMessageId: id } },
  });
  if (!issue) return null;
  const html = issue.html ?? undefined;
  let text = issue.text ?? "";
  if (html && !issue.text) {
    text = (await extractArticleContent(html)).text;
    await prisma.newsletterIssue.update({ where: { id: issue.id }, data: { text } });
  }
  return {
    id: issue.gmailMessageId,
    threadId: issue.threadId,
    subject: issue.subject,
    from: `${issue.fromName} <${issue.fromEmail}>`,
    date: issue.receivedAt.toISOString(),
    snippet: issue.snippet,
    hasHtml: Boolean(html),
    hasText: Boolean(text),
    html,
    text: text ? normalizeText(text) : undefined,
    externalUrl: issue.webUrl,
    sourceKind: "gmail" as const,
    publicationName: publicationNameFor(issue.fromEmail, issue.fromName),
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
      const res = await fetch(item.link, { headers: { "User-Agent": "clucks-feed/1.0" } });
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

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getSessionUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await params;
  if (!rawId) return NextResponse.json({ error: "Missing id in path" }, { status: 400 });
  const id = decodeItemId(rawId);

  if (id.startsWith(WEB_ID_PREFIX)) {
    const data = await getSavedArticleItem(auth.userId, id);
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  }

  if (id.startsWith("rss:")) {
    const data = await getRssItem(auth.userId, id);
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  }

  const stored = await getStoredNewsletterItem(auth.userId, id);
  if (stored) return NextResponse.json(stored);

  // Every newsletter in the feed is stored at sync time, so an id that isn't
  // stored is unknown rather than something to fetch live from Gmail.
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await params;
  if (!rawId) return NextResponse.json({ error: "Missing id in path" }, { status: 400 });
  const id = decodeItemId(rawId);

  if (!id.startsWith("rss:")) {
    return NextResponse.json({ error: "Only RSS items can be deleted from the local database" }, { status: 400 });
  }

  const rssItemId = id.replace(/^rss:/, "");
  const item = await prisma.rssItem.findUnique({
    where: { id: rssItemId },
    select: { id: true, rssSourceId: true },
  });
  if (!item) return NextResponse.json({ ok: true, deleted: false });

  const sub = await prisma.userRssSubscription.findUnique({
    where: { userId_rssSourceId: { userId, rssSourceId: item.rssSourceId } },
    select: { id: true, isActive: true },
  });
  if (!sub?.isActive) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.$transaction([
    prisma.messageReadStat.deleteMany({
      where: {
        userId,
        messageExternalId: id,
      },
    }),
    prisma.rssItem.delete({ where: { id: rssItemId } }),
  ]);

  return NextResponse.json({ ok: true, deleted: true });
}
