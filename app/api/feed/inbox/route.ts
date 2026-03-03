import { google, gmail_v1 } from "googleapis";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { classifyNewsletter, getHeader } from "@/lib/newsletter-classifier";
import { parseFrom, normalizePublicationKey } from "@/lib/email";
import { prisma } from "@/lib/prisma";
type RssPriority = "HIGH" | "NORMAL" | "LOW";

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

function getGmailLookbackDays(): number {
  const raw = Number(process.env.GMAIL_LOOKBACK_DAYS ?? 5);
  if (!Number.isFinite(raw)) return 5;
  return Math.min(30, Math.max(1, Math.floor(raw)));
}

async function getGmailFeed(accessToken?: string): Promise<FeedItem[]> {
  if (!accessToken) return [];
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const lookbackDays = getGmailLookbackDays();
  let messages: gmail_v1.Schema$Message[] = [];
  try {
    const list = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["INBOX"],
      q: `newer_than:${lookbackDays}d -in:chats`,
      maxResults: 100,
    });
    messages = list.data.messages ?? [];
  } catch (error) {
    const status = (error as { code?: number; status?: number; response?: { status?: number } })
      .response?.status ??
      (error as { code?: number; status?: number }).code ??
      (error as { code?: number; status?: number }).status;
    if (status === 401 || status === 403) return [];
    throw error;
  }
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
          "Mailing-List",
          "Feedback-ID",
        ],
      });

      const headers = fullMessage.data.payload?.headers;
      const subject = getHeader(headers, "Subject");
      const from = getHeader(headers, "From");
      const date = getHeader(headers, "Date");
      const snippet = fullMessage.data.snippet ?? "";
      const classification = classifyNewsletter(headers, subject, from, snippet);
      if (!classification.isNewsletter) {
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
        snippet,
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
          imageUrl: item.imageUrl ?? extractImageUrl(item.htmlRaw),
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



