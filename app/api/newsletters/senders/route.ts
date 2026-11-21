import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/session-user";
import { normalizeSenderEmail } from "@/lib/newsletter-sync-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const senders = await prisma.newsletterSender.findMany({
    where: { userId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true },
  });
  return NextResponse.json(senders);
}

/** Add one or more senders. Body: { emails: string[] } or { email, name? }. */
export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const rawList: unknown[] = Array.isArray(body?.emails) ? body.emails : [body?.email];
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) || null : null;

  const emails = rawList
    .filter((v): v is string => typeof v === "string")
    .flatMap((v) => v.split(/[\s,;]+/))
    .map(normalizeSenderEmail)
    .filter((v): v is string => v !== null);
  if (emails.length === 0) {
    return NextResponse.json({ error: "No valid email addresses" }, { status: 400 });
  }

  await prisma.$transaction([
    ...emails.map((email) =>
      prisma.newsletterSender.upsert({
        where: { userId_email: { userId, email } },
        update: { isActive: true, ...(name && emails.length === 1 ? { name } : {}) },
        create: { userId, email, name: emails.length === 1 ? name : null },
      })
    ),
    // A new sender list changes what "already synced" means: rewind so the
    // next sync backfills the full first-sync window for the new senders.
    prisma.gmailAccount.updateMany({ where: { userId }, data: { syncedAt: null } }),
  ]);
  return NextResponse.json({ ok: true, added: emails });
}

export async function DELETE(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const email = normalizeSenderEmail(new URL(req.url).searchParams.get("email") ?? "");
  if (!email) return NextResponse.json({ error: "Missing email" }, { status: 400 });
  // Soft-delete: already-stored issues from this sender stay readable.
  await prisma.newsletterSender.updateMany({
    where: { userId, email },
    data: { isActive: false },
  });
  return NextResponse.json({ ok: true });
}
