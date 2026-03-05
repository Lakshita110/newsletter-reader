import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type SearchRow = {
  id: string;
  sourceId: string;
  title: string;
  link: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  sourceName: string;
  excerpt: string;
  rank: number;
};

function isMissingSearchVector(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2010") return false;
  const meta = error.meta as { code?: string; message?: string } | undefined;
  if (meta?.code !== "42703") return false;
  return (meta?.message ?? "").includes("searchVector");
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const sourceId = url.searchParams.get("sourceId")?.trim();
  if (!q) return NextResponse.json({ items: [] });

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
    select: { id: true },
  });

  const likeQuery = `%${q}%`;
  let rows: SearchRow[] = [];
  try {
    rows = await prisma.$queryRaw<SearchRow[]>`
      SELECT
        ri.id,
        ri."rssSourceId" AS "sourceId",
        ri.title,
        ri.link,
        ri."publishedAt",
        ri."createdAt",
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
        AND (${sourceId ?? null} IS NULL OR ri."rssSourceId" = ${sourceId ?? null})
      ORDER BY rank DESC
      LIMIT 30
    `;
  } catch (error) {
    if (!isMissingSearchVector(error)) throw error;
    rows = await prisma.$queryRaw<SearchRow[]>`
      SELECT
        ri.id,
        ri."rssSourceId" AS "sourceId",
        ri.title,
        ri.link,
        ri."publishedAt",
        ri."createdAt",
        rs.name AS "sourceName",
        left(coalesce(ri."textExtracted", ri.snippet, ''), 260) AS excerpt,
        0::real AS rank
      FROM "RssItem" ri
      JOIN "RssSource" rs ON rs.id = ri."rssSourceId"
      JOIN "UserRssSubscription" urs
        ON urs."rssSourceId" = ri."rssSourceId"
        AND urs."userId" = ${user.id}
        AND urs."isActive" = true
      WHERE (
        ri.title ILIKE ${likeQuery}
        OR coalesce(ri."textExtracted", ri.snippet, '') ILIKE ${likeQuery}
      )
      AND (${sourceId ?? null} IS NULL OR ri."rssSourceId" = ${sourceId ?? null})
      ORDER BY coalesce(ri."publishedAt", ri."createdAt") DESC
      LIMIT 30
    `;
  }

  const items = rows.map((row) => ({
    id: `rss:${row.id}`,
    sourceId: row.sourceId,
    title: row.title,
    link: row.link,
    publishedAt: row.publishedAt ?? row.createdAt,
    sourceName: row.sourceName,
    excerpt: row.excerpt,
  }));

  return NextResponse.json({ items });
}
