import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session-user";
import { refreshTodaySnapshotForUser } from "@/lib/rank-refresh";
import { readMostRecentSnapshot } from "@/lib/rank-snapshot";
import { dayKeyUtc } from "@/lib/rss-helpers";

export const dynamic = "force-dynamic";
// A strong model ranking ~100 candidates can take tens of seconds.
export const maxDuration = 60;

/** Ignore repeat taps: one paid ranking call per user per window is plenty. */
const MIN_INTERVAL_MS = 3 * 60 * 1000;

/**
 * "Rank now" from Today. Cron already ranks a few times a day; this exists
 * for when it hasn't yet (new sources, first use, a failed run) so she isn't
 * stuck with an unranked newest-first list until the next scheduled run.
 */
export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const latest = await readMostRecentSnapshot(userId);
  if (
    latest?.status === "AI_SUCCESS" &&
    latest.source === "ON_DEMAND" &&
    Date.now() - latest.updatedAt.getTime() < MIN_INTERVAL_MS
  ) {
    return NextResponse.json({ ok: true, status: latest.status, skipped: true, reason: "ranked moments ago" });
  }

  const result = await refreshTodaySnapshotForUser(userId, dayKeyUtc(new Date()), "ON_DEMAND");
  console.info(
    `[rank-now] userId="${userId}" status="${result.status}" candidates=${result.candidates} selected=${result.selected} skipped=${result.skipped}`
  );
  if (result.status !== "AI_SUCCESS" && result.candidates > 0) {
    // Surface the failure instead of pretending it worked; details are in the
    // [rss-ranker] log lines (missing key, every model failing, bad output).
    return NextResponse.json(
      { ok: false, status: result.status, error: "Ranking failed. The app is showing newest first for now." },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, ...result });
}
