import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const sub = await prisma.userRssSubscription.findUnique({
    where: { id: subscriptionId },
    include: { source: true },
  });
  if (!sub || sub.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.rssSource.update({
    where: { id: sub.rssSourceId },
    data: { name },
  });

  return NextResponse.json({ ok: true });
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

  await prisma.userRssSubscription.delete({
    where: { id: subscriptionId },
  });

  return NextResponse.json({ ok: true });
}
