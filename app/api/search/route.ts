import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type SearchRow = {
  id: string;
  title: string;
  link: string | null;
  publishedAt: Date | null;
  sourceName: string;
  excerpt: string;
  rank: number;
};

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ items: [] });

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
    select: { id: true },
  });

  const rows = await prisma.$queryRaw<SearchRow[]>`
    SELECT
      ri.id,
      ri.title,
      ri.link,
      ri."publishedAt",
      rs.name AS "sourceName",
      ts_headline(
        'english',
        coalesce(ri."textExtracted", ri.snippet, ''),
        query,
        'MaxWords=35, MinWords=15, StartSel=<mark>, StopSel=</mark>'
      ) AS excerpt,
      ts_rank(ri."searchVector", query) AS rank
    FROM "RssItem" ri
    JOIN "RssSource" rs ON rs.id = ri."rssSourceId"
    JOIN "UserRssSubscription" urs
      ON urs."rssSourceId" = ri."rssSourceId"
      AND urs."userId" = ${user.id}
      AND urs."isActive" = true
    , plainto_tsquery('english', ${q}) query
    WHERE ri."searchVector" @@ query
    ORDER BY rank DESC
    LIMIT 30
  `;

  const items = rows.map((row) => ({
    id: `rss:${row.id}`,
    title: row.title,
    link: row.link,
    publishedAt: row.publishedAt,
    sourceName: row.sourceName,
    excerpt: row.excerpt,
  }));

  return NextResponse.json({ items });
}
