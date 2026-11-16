import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/session-user";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Edit the note on a highlight. */
export async function PATCH(req: Request, { params }: Ctx) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const note = typeof body?.note === "string" ? body.note.slice(0, 5000).trim() || null : null;
  const res = await prisma.highlight.updateMany({ where: { id, userId }, data: { note } });
  if (res.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await prisma.highlight.deleteMany({ where: { id, userId } });
  return NextResponse.json({ ok: true });
}
