import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/session-user";
import {
  extractImageUrlFromHtml,
  getRssLookbackCutoff,
  getRssLookbackDays,
} from "@/lib/rss-helpers";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sourceId: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sourceId } = await params;
  if (!sourceId) {
    return NextResponse.json({ error: "Missing source id" }, { status: 400 });
  }
  const rssCutoff = getRssLookbackCutoff(getRssLookbackDays());

  const sub = await prisma.userRssSubscription.findUnique({
    where: { userId_rssSourceId: { userId, rssSourceId: sourceId } },
    include: {
      source: {
        include: {
          items: {
            where: {
              OR: [
                { publishedAt: { gte: rssCutoff } },
                { AND: [{ publishedAt: null }, { createdAt: { gte: rssCutoff } }] },
              ],
            },
            orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
            take: 500,
          },
        },
      },
    },
  });

  if (!sub?.isActive) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    source: {
      id: sub.source.id,
      name: sub.source.name,
      rssUrl: sub.source.rssUrl,
      siteUrl: sub.source.siteUrl,
    },
    items: sub.source.items.map((item) => ({
      id: `rss:${item.id}`,
      sourceId: sub.source.id,
      sourceKind: "rss",
      subject: item.title,
      from: item.author ?? sub.source.name,
      date: (item.publishedAt ?? item.createdAt).toISOString(),
      snippet: item.snippet ?? "",
      publicationName: sub.source.name,
      publicationKey: `rss:${sub.source.id}`,
      isOverflow: false,
      externalUrl: item.link ?? undefined,
      imageUrl: item.imageUrl ?? extractImageUrlFromHtml(item.htmlRaw),
    })),
  });
}
