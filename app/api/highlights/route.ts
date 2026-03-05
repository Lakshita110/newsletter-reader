import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    text?: string;
    note?: string;
    rssItemId?: string;
    savedArticleId?: string;
  };

  const { text, note, rssItemId, savedArticleId } = body;
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
  if ((rssItemId && savedArticleId) || (!rssItemId && !savedArticleId)) {
    return NextResponse.json(
      { error: "Provide exactly one of rssItemId or savedArticleId" },
      { status: 400 },
    );
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
    select: { id: true },
  });

  if (savedArticleId) {
    const savedArticle = await prisma.savedArticle.findFirst({
      where: {
        id: savedArticleId,
        userId: user.id,
      },
      select: { id: true },
    });

    if (!savedArticle) {
      return NextResponse.json({ error: "Saved article not found" }, { status: 404 });
    }
  }

  if (rssItemId) {
    const rssItem = await prisma.rssItem.findUnique({
      where: { id: rssItemId },
      select: { id: true },
    });

    if (!rssItem) {
      return NextResponse.json({ error: "RSS item not found" }, { status: 404 });
    }
  }

  const highlight = await prisma.highlight.create({
    data: {
      userId: user.id,
      text,
      note: note ?? null,
      rssItemId: rssItemId ?? null,
      savedArticleId: savedArticleId ?? null,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: highlight.id });
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
  const rssItemId = url.searchParams.get("rssItemId");
  const savedArticleId = url.searchParams.get("savedArticleId");

  const highlights = await prisma.highlight.findMany({
    where: {
      userId: user.id,
      ...(rssItemId ? { rssItemId } : {}),
      ...(savedArticleId ? { savedArticleId } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, text: true, note: true, createdAt: true },
  });

  return NextResponse.json({ highlights });
}
