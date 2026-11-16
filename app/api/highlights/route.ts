import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/session-user";

export const dynamic = "force-dynamic";

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.slice(0, max) : null);

/** ?itemId= for one article's highlights; ?since=ISO for the highlights page / weekly export. */
export async function GET(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const itemId = params.get("itemId");
  const since = params.get("since");
  const sinceDate = since ? new Date(since) : null;
  const highlights = await prisma.highlight.findMany({
    where: {
      userId,
      ...(itemId ? { itemId } : {}),
      ...(sinceDate && !Number.isNaN(sinceDate.getTime()) ? { createdAt: { gte: sinceDate } } : {}),
    },
    orderBy: { createdAt: itemId ? "asc" : "desc" },
    take: itemId ? 500 : 1000,
  });
  return NextResponse.json(highlights);
}

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const itemId = str(body?.itemId, 300);
  const quote = str(body?.quote, 5000);
  if (!itemId || !quote) return NextResponse.json({ error: "itemId and quote are required" }, { status: 400 });
  const highlight = await prisma.highlight.create({
    data: {
      userId,
      itemId,
      quote,
      itemTitle: str(body?.itemTitle, 500) ?? "(Untitled)",
      publicationName: str(body?.publicationName, 200),
      itemUrl: str(body?.itemUrl, 2000),
      prefix: str(body?.prefix, 100),
      suffix: str(body?.suffix, 100),
      note: str(body?.note, 5000),
    },
  });
  return NextResponse.json(highlight, { status: 201 });
}
