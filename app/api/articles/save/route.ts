import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    url?: string;
    title?: string;
    text?: string;
    author?: string;
    source?: string;
  };

  const { url, title, text, author, source } = body;
  if (!url || !title || !text) {
    return NextResponse.json({ error: "url, title, and text are required" }, { status: 400 });
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
    select: { id: true },
  });

  const article = await prisma.savedArticle.upsert({
    where: { userId_url: { userId: user.id, url } },
    update: { title, text, author: author ?? null, source: source ?? null, savedAt: new Date() },
    create: { userId: user.id, url, title, text, author: author ?? null, source: source ?? null },
    select: { id: true },
  });

  return NextResponse.json({ id: article.id });
}
