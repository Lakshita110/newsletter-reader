import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.readState.findMany({
    where: { userEmail: email },
    select: { messageId: true, readAt: true },
  });

  return NextResponse.json({
    readIds: rows.map((r) => r.messageId),
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const messageId = typeof body?.messageId === "string" ? body.messageId : "";
  if (!messageId) {
    return NextResponse.json({ error: "Missing messageId" }, { status: 400 });
  }

  await prisma.readState.upsert({
    where: { userEmail_messageId: { userEmail: email, messageId } },
    update: { readAt: new Date() },
    create: { userEmail: email, messageId },
  });

  return NextResponse.json({ ok: true });
}
