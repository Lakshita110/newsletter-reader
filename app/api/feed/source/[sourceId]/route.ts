import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRssLookbackCutoff, getRssLookbackDays } from "@/lib/rss-helpers";

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
  const sourceId = url.pathname.split("/").filter(Boolean).pop();
  if (!sourceId) {
    return NextResponse.json({ error: "Missing source id" }, { status: 400 });
  }
  const rssCutoff = getRssLookbackCutoff(getRssLookbackDays());

  const sub = await prisma.userRssSubscription.findUnique({
    where: { userId_rssSourceId: { userId: user.id, rssSourceId: sourceId } },
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

  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const extractImageUrl = (html?: string | null): string | undefined => {
    if (!html) return undefined;
    const og = html.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
    );
    if (og?.[1]) return og[1];
    const img = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (img?.[1]) return img[1];
    return undefined;
  };

  return NextResponse.json({
    source: {
      id: sub.source.id,
      name: sub.source.name,
      rssUrl: sub.source.rssUrl,
      siteUrl: sub.source.siteUrl,
      dailyCap: sub.dailyCap,
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
      imageUrl: item.imageUrl ?? extractImageUrl(item.htmlRaw),
    })),
  });
}
