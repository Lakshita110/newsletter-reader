import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const subscriptions = await prisma.userRssSubscription.findMany({
    where: { userId },
    include: { source: true },
    orderBy: [{ updatedAt: "desc" }],
  });

  return NextResponse.json(
    subscriptions.map((sub) => ({
      id: sub.id,
      sourceId: sub.source.id,
      name: sub.source.name,
      rssUrl: sub.source.rssUrl,
      siteUrl: sub.source.siteUrl,
      isActive: sub.isActive,
      priority: sub.priority,
      dailyCap: sub.dailyCap,
      lastSyncedAt: sub.source.lastSyncedAt,
    }))
  );
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rssUrl = typeof body?.rssUrl === "string" ? body.rssUrl.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const siteUrl = typeof body?.siteUrl === "string" ? body.siteUrl.trim() : "";
  const normalized = normalizeUrl(rssUrl);
  if (!normalized) {
    return NextResponse.json({ error: "Missing rssUrl" }, { status: 400 });
  }

  const source = await prisma.rssSource.upsert({
    where: { normalizedUrl: normalized },
    update: {
      name: name || undefined,
      siteUrl: siteUrl || undefined,
      rssUrl: normalized,
    },
    create: {
      name: name || normalized,
      rssUrl: normalized,
      normalizedUrl: normalized,
      siteUrl: siteUrl || null,
    },
  });

  const subscription = await prisma.userRssSubscription.upsert({
    where: { userId_rssSourceId: { userId, rssSourceId: source.id } },
    update: { isActive: true },
    create: { userId, rssSourceId: source.id },
  });

  return NextResponse.json({
    ok: true,
    subscriptionId: subscription.id,
    sourceId: source.id,
  });
}

