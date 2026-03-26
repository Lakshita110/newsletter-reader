import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseRssCategoryInput } from "@/lib/rss-categories";
import { normalizeUrl } from "@/lib/rss";

async function getUserId() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
    select: { id: true },
  });
  return user.id;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ subscriptionId: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { subscriptionId } = await params;
  if (!subscriptionId) {
    return NextResponse.json({ error: "Missing subscription id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const rssUrl = typeof body?.rssUrl === "string" ? body.rssUrl.trim() : "";
  const parsedCategory = parseRssCategoryInput(body?.category);
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!rssUrl) {
    return NextResponse.json({ error: "RSS URL is required" }, { status: 400 });
  }
  if (parsedCategory.isInvalid) {
    return NextResponse.json({ error: "Invalid category option" }, { status: 400 });
  }
  if (!parsedCategory.isProvided || !parsedCategory.value) {
    return NextResponse.json({ error: "Category is required" }, { status: 400 });
  }
  const normalizedUrl = normalizeUrl(rssUrl);

  const sub = await prisma.userRssSubscription.findUnique({
    where: { id: subscriptionId },
    include: { source: true },
  });
  if (!sub || sub.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await prisma.rssSource.update({
      where: { id: sub.rssSourceId },
      data: {
        name,
        rssUrl: normalizedUrl,
        normalizedUrl,
      },
    });

    const updated = await prisma.userRssSubscription.update({
      where: { id: subscriptionId },
      data: { category: parsedCategory.value },
      select: { category: true },
    });

    return NextResponse.json({ ok: true, category: updated.category });
  } catch (error) {
    const maybeCode = error as { code?: string };
    if (maybeCode.code === "P2002") {
      return NextResponse.json({ error: "That RSS URL is already in use." }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ subscriptionId: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { subscriptionId } = await params;
  if (!subscriptionId) {
    return NextResponse.json({ error: "Missing subscription id" }, { status: 400 });
  }

  const sub = await prisma.userRssSubscription.findUnique({
    where: { id: subscriptionId },
    select: { id: true, userId: true },
  });
  if (!sub || sub.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.userRssSubscription.update({
    where: { id: subscriptionId },
    data: { isActive: false },
  });

  return NextResponse.json({ ok: true });
}
