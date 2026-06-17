import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const configured = process.env.CRON_SECRET;
  if (!configured) return false;
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return bearer === configured || (req.headers.get("x-cron-secret") ?? "") === configured;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(
    100,
    Math.max(1, Number.isFinite(Number(limitParam)) ? Number(limitParam) : 20)
  );

  const where = userId ? { userId } : {};
  const rows = await prisma.rssRankEvalLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      userId: true,
      dayKey: true,
      overallScore: true,
      diversityScore: true,
      qualityScore: true,
      issues: true,
      suggestions: true,
      model: true,
      source: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ ok: true, count: rows.length, rows });
}
