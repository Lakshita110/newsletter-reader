import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function getUserId(): Promise<string | null> {
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

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { weeklyReadingGoal: true },
  });
  const weeklyGoal = user?.weeklyReadingGoal ?? 5;

  // Pull last 60 days of completed reads to compute streak
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const reads = await prisma.messageReadStat.findMany({
    where: {
      userId,
      OR: [{ completedAt: { not: null, gte: cutoff } }, { completionPct: { gte: 99 }, updatedAt: { gte: cutoff } }],
    },
    select: { completedAt: true, updatedAt: true },
  });

  // Group into day buckets (UTC)
  const daySet = new Set<string>();
  const today = toDateKey(new Date());
  let todayCount = 0;
  for (const row of reads) {
    const d = toDateKey(row.completedAt ?? row.updatedAt);
    daySet.add(d);
    if (d === today) todayCount += 1;
  }

  // Compute streak: consecutive days ending today (or yesterday if nothing read today yet)
  let streak = 0;
  const cursor = new Date();
  // Start from today; if nothing today, start yesterday
  if (!daySet.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (daySet.has(toDateKey(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  // Weekly count (Mon–Sun of current UTC week)
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now);
  weekStart.setUTCDate(now.getUTCDate() - mondayOffset);
  weekStart.setUTCHours(0, 0, 0, 0);
  const weekStartKey = toDateKey(weekStart);
  let weeklyCount = 0;
  for (const key of daySet) {
    if (key >= weekStartKey && key <= today) weeklyCount += 1;
  }

  return NextResponse.json({ streak, todayCount, weeklyCount, weeklyGoal });
}
