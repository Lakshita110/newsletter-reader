import { google, gmail_v1 } from "googleapis";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { parseFrom, normalizePublicationKey } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { RssPriority } from "@prisma/client";

type FeedItem = {
  id: string;
  sourceId?: string;
  sourceKind: "gmail" | "rss";
  subject: string;
  from: string;
  date: string;
  snippet: string;
  publicationName: string;
  publicationKey: string;
  isOverflow?: boolean;
  externalUrl?: string;
  imageUrl?: string;
};

function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  return (
    headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  );
}

function looksLikeNewsletter(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  subject: string,
  from: string,
  snippet: string
) {
  const listId = getHeader(headers, "List-Id");
  const listUnsub = getHeader(headers, "List-Unsubscribe");
  const listUnsubPost = getHeader(headers, "List-Unsubscribe-Post");
  const precedence = getHeader(headers, "Precedence");
  const xListId = getHeader(headers, "X-List-Id");
  const xList = getHeader(headers, "X-List");

  if (listId || listUnsub || listUnsubPost || xListId || xList) return true;
  if (/^(bulk|list|junk)$/i.test(precedence)) return true;

  const hay = `${subject} ${from} ${snippet}`.toLowerCase();
  const keywords =
    /(newsletter|digest|roundup|weekly|monthly|edition|issue|briefing|update|bulletin)/;
  const fromSignals = /(noreply|no-reply|newsletter|updates|digest|bulletin)/;
  const footerSignals = /(view in browser|unsubscribe|manage preferences)/;

  if (keywords.test(hay)) return true;
  if (fromSignals.test(hay)) return true;
  if (footerSignals.test(hay)) return true;

  return false;
}

function dayKeyUtc(value: Date | null): string {
  if (!value) return "unknown";
  const y = value.getUTCFullYear();
  const m = `${value.getUTCMonth() + 1}`.padStart(2, "0");
  const d = `${value.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function priorityScore(priority: RssPriority): number {
  if (priority === "HIGH") return 3;
  if (priority === "NORMAL") return 2;
  return 1;
}

function extractImageUrl(html?: string | null): string | undefined {
  if (!html) return undefined;
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) return og[1];
  const img = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (img?.[1]) return img[1];
  return undefined;
}

async function getUserAndToken() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
    select: { id: true },
  });
  return {
    userId: user.id,
    accessToken: session?.accessToken as string | undefined,
  };
}

async function getGmailFeed(accessToken?: string): Promise<FeedItem[]> {
  if (!accessToken) return [];
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const list = await gmail.users.messages.list({
    userId: "me",
    q: "newer_than:30d",
    maxResults: 40,
  });

  const messages = list.data.messages ?? [];
  const results = await Promise.all(
    messages.map(async (message) => {
      const id = message.id;
      if (!id) return null;

      const fullMessage = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: [
          "Subject",
          "From",
          "Date",
          "List-Id",
          "List-Unsubscribe",
          "List-Unsubscribe-Post",
          "Precedence",
          "X-List-Id",
          "X-List",
        ],
      });

      const headers = fullMessage.data.payload?.headers;
      const subject = getHeader(headers, "Subject");
      const from = getHeader(headers, "From");
      const date = getHeader(headers, "Date");
      if (!looksLikeNewsletter(headers, subject, from, fullMessage.data.snippet ?? "")) {
        return null;
      }

      const parsed = parseFrom(from);
      const publicationName = parsed.name;
      const publicationKey = normalizePublicationKey(publicationName);

      return {
        id,
        sourceKind: "gmail" as const,
        subject,
        from,
        date,
        snippet: fullMessage.data.snippet ?? "",
        publicationName,
        publicationKey,
      };
    })
  );

  return results.filter((x): x is NonNullable<typeof x> => x !== null);
}

async function getRssFeed(userId: string) {
  const subscriptions = await prisma.userRssSubscription.findMany({
    where: { userId, isActive: true },
    include: {
      source: {
        include: {
          items: {
            orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
            take: 300,
          },
        },
      },
    },
  });

  const visible: FeedItem[] = [];
  const overflowBySource = new Map<string, { sourceId: string; sourceName: string; count: number }>();

  for (const sub of subscriptions) {
    const byDay = new Map<string, typeof sub.source.items>();
    for (const item of sub.source.items) {
      const key = dayKeyUtc(item.publishedAt ?? null);
      const list = byDay.get(key) ?? [];
      list.push(item);
      byDay.set(key, list);
    }

    for (const [, dayItems] of byDay) {
      dayItems.sort((a, b) => {
        const pa = priorityScore(sub.priority);
        const pb = priorityScore(sub.priority);
        if (pa !== pb) return pb - pa;
        const ta = a.publishedAt?.getTime() ?? a.createdAt.getTime();
        const tb = b.publishedAt?.getTime() ?? b.createdAt.getTime();
        return tb - ta;
      });

      const cap = sub.dailyCap;
      for (let i = 0; i < dayItems.length; i++) {
        const item = dayItems[i];
        const isOverflow = cap <= 0 || i >= cap;
        const feedItem: FeedItem = {
          id: `rss:${item.id}`,
          sourceId: sub.source.id,
          sourceKind: "rss",
          subject: item.title,
          from: item.author ?? sub.source.name,
          date: (item.publishedAt ?? item.createdAt).toISOString(),
          snippet: item.snippet ?? "",
          publicationName: sub.source.name,
          publicationKey: `rss:${sub.source.id}`,
          isOverflow,
          externalUrl: item.link ?? undefined,
          imageUrl: extractImageUrl(item.htmlRaw),
        };
        if (!isOverflow) visible.push(feedItem);
        else {
          const prev = overflowBySource.get(sub.source.id) ?? {
            sourceId: sub.source.id,
            sourceName: sub.source.name,
            count: 0,
          };
          prev.count += 1;
          overflowBySource.set(sub.source.id, prev);
        }
      }
    }
  }

  return {
    visible,
    overflowBySource: [...overflowBySource.values()].sort((a, b) => b.count - a.count),
  };
}

export async function GET(req: Request) {
  const auth = await getUserAndToken();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");

  const [gmailItems, rss] = await Promise.all([
    getGmailFeed(auth.accessToken),
    getRssFeed(auth.userId),
  ]);

  let items = [...gmailItems, ...rss.visible].sort((a, b) => {
    const ta = new Date(a.date).getTime();
    const tb = new Date(b.date).getTime();
    return tb - ta;
  });
  if (kind === "rss") items = items.filter((it) => it.sourceKind === "rss");
  if (kind === "newsletters") items = items.filter((it) => it.sourceKind === "gmail");

  return NextResponse.json({
    items,
    overflowBySource: rss.overflowBySource,
  });
}
