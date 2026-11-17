import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncRssSource } from "@/lib/rss";
import { dayKeyUtc } from "@/lib/rss-helpers";
import { isCronAuthorized } from "@/lib/cron-auth";
import { refreshTodaySnapshotForUser } from "@/lib/rank-refresh";

export { refreshTodaySnapshotForUser };

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  console.info(
    `[rss-refresh-rank][${requestId}] invoked method="${req.method}" userAgent="${req.headers.get("user-agent") ?? ""}" hasAuth="${Boolean(req.headers.get("authorization"))}" hasCronSecret="${Boolean(req.headers.get("x-cron-secret"))}"`
  );
  if (!isCronAuthorized(req)) {
    console.warn(`[rss-refresh-rank][${requestId}] unauthorized`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const dayKey = dayKeyUtc(new Date());
    const activeSources = await prisma.userRssSubscription.findMany({
      where: { isActive: true },
      select: { rssSourceId: true },
      distinct: ["rssSourceId"],
    });
    console.info(
      `[rss-refresh-rank][${requestId}] starting sync day="${dayKey}" activeSources=${activeSources.length}`
    );

    const syncResults = await Promise.allSettled(
      activeSources.map((row) => syncRssSource(row.rssSourceId))
    );

    let syncedSources = 0;
    let syncInserted = 0;
    let syncUpdated = 0;
    const syncErrors: string[] = [];

    for (let i = 0; i < activeSources.length; i++) {
      const row = activeSources[i];
      const result = syncResults[i];
      if (result.status === "fulfilled") {
        syncInserted += result.value.inserted;
        syncUpdated += result.value.updated;
        syncedSources += 1;
        console.info(
          `[rss-refresh-rank][${requestId}] synced sourceId="${row.rssSourceId}" inserted=${result.value.inserted} updated=${result.value.updated}`
        );
      } else {
        const message = `${row.rssSourceId}: ${result.reason instanceof Error ? result.reason.message : "Unknown error"}`;
        syncErrors.push(message);
        console.error(`[rss-refresh-rank][${requestId}] sync failed ${message}`);
      }
    }

    const activeUsers = await prisma.userRssSubscription.findMany({
      where: { isActive: true },
      select: { userId: true },
      distinct: ["userId"],
    });
    console.info(
      `[rss-refresh-rank][${requestId}] starting ranking day="${dayKey}" activeUsers=${activeUsers.length}`
    );

    let rankedUsers = 0;
    let skippedUsers = 0;
    const rankErrors: string[] = [];
    const rankSummaries: Array<{
      userId: string;
      candidates: number;
      selected: number;
      status: string;
      totalCap: number;
      skipped: boolean;
    }> = [];

    for (const row of activeUsers) {
      try {
        const result = await refreshTodaySnapshotForUser(row.userId, dayKey);
        rankedUsers += 1;
        if (result.skipped) skippedUsers += 1;
        rankSummaries.push({ userId: row.userId, ...result });
        console.info(
          `[rss-refresh-rank][${requestId}] ranked userId="${row.userId}" candidates=${result.candidates} selected=${result.selected} totalCap=${result.totalCap} status="${result.status}" skipped=${result.skipped}`
        );
      } catch (error) {
        const message = `${row.userId}: ${error instanceof Error ? error.message : "Unknown error"}`;
        rankErrors.push(message);
        console.error(`[rss-refresh-rank][${requestId}] ranking failed ${message}`);
      }
    }

    console.info(
      `[rss-refresh-rank][${requestId}] completed day="${dayKey}" syncedSources=${syncedSources} syncInserted=${syncInserted} syncUpdated=${syncUpdated} rankedUsers=${rankedUsers} skippedUsers=${skippedUsers} syncErrors=${syncErrors.length} rankErrors=${rankErrors.length}`
    );

    return NextResponse.json({
      ok: true,
      dayKey,
      syncedSources,
      syncInserted,
      syncUpdated,
      rankedUsers,
      skippedUsers,
      syncErrors,
      rankErrors,
      rankSummaries: rankSummaries.slice(0, 20),
    });
  } catch (error) {
    console.error(
      `[rss-refresh-rank][${requestId}] fatal error`,
      error
    );
    return NextResponse.json({ error: "Cron execution failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET(req);
}
