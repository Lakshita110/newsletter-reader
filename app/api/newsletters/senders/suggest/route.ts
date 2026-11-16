import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserWithAccessToken } from "@/lib/session-user";
import { suggestNewsletterSenders } from "@/lib/newsletter-sync";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getSessionUserWithAccessToken();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [suggestions, current] = await Promise.all([
    suggestNewsletterSenders(auth.accessToken),
    prisma.newsletterSender.findMany({
      where: { userId: auth.userId, isActive: true },
      select: { email: true },
    }),
  ]);
  const have = new Set(current.map((s) => s.email));
  return NextResponse.json(suggestions.filter((s) => !have.has(s.email)).slice(0, 25));
}
