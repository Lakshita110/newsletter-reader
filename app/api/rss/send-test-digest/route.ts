import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createDigestTransporter, sendDigestForUser } from "@/lib/send-daily-digest";

export async function POST() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const transporter = createDigestTransporter();
  if (!transporter) {
    return NextResponse.json(
      { error: "Email sending isn't configured on this deployment (missing GMAIL_USER / GMAIL_APP_PASSWORD)." },
      { status: 503 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, digestEmail: true, digestTimezone: true, digestLastSentAt: true },
  });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await sendDigestForUser({
    transporter,
    fromEmail: process.env.GMAIL_USER!,
    user,
    force: true,
  });

  if (result.status === "sent") {
    return NextResponse.json({ ok: true, itemCount: result.itemCount, sentTo: result.sentTo });
  }
  if (result.status === "skipped") {
    return NextResponse.json(
      {
        ok: false,
        reason: result.reason,
        error: "No recommended articles are ranked for today yet — open the RSS inbox once to trigger ranking, then try again.",
      },
      { status: 200 }
    );
  }
  return NextResponse.json({ ok: false, error: result.message }, { status: 500 });
}
