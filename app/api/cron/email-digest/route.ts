import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createDigestTransporter, sendDigestForUser } from "@/lib/send-daily-digest";
import { isCronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const transporter = createDigestTransporter();
  if (!transporter) {
    return NextResponse.json({ error: "GMAIL_USER and GMAIL_APP_PASSWORD must be set" }, { status: 503 });
  }

  const url = new URL(req.url);
  // ?force=true skips the duplicate-send guard — for testing only
  const force = url.searchParams.get("force") === "true";

  const fromEmail = process.env.GMAIL_USER!;

  const eligibleUsers = await prisma.user.findMany({
    where: { digestEnabled: true },
    select: {
      id: true,
      email: true,
      digestEmail: true,
      digestTimezone: true,
      digestLastSentAt: true,
    },
  });

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const user of eligibleUsers) {
    const result = await sendDigestForUser({ transporter, fromEmail, user, force });
    if (result.status === "sent") {
      sent += 1;
    } else if (result.status === "skipped") {
      skipped += 1;
    } else {
      errors.push(`${user.email}: ${result.message}`);
      console.error("[email-digest] failed", `${user.email}: ${result.message}`);
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, errors });
}

export async function POST(req: Request) {
  return GET(req);
}
