import { NextResponse } from "next/server";
import { runRetentionNow } from "@/lib/retention";

function isAuthorized(req: Request): boolean {
  const configured = process.env.CRON_SECRET;
  if (!configured) return false;

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const header = req.headers.get("x-cron-secret") ?? "";

  return bearer === configured || header === configured;
}

async function run(req: Request) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  console.info(
    `[retention][${requestId}] invoked method="${req.method}" userAgent="${req.headers.get("user-agent") ?? ""}" hasAuth="${Boolean(req.headers.get("authorization"))}" hasCronSecret="${Boolean(req.headers.get("x-cron-secret"))}"`
  );
  if (!isAuthorized(req)) {
    console.warn(`[retention][${requestId}] unauthorized`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runRetentionNow();
    console.info(
      `[retention][${requestId}] completed rssSavedItemsCompacted=${result.rssSavedItemsCompacted} rssDeletedByAge=${result.rssDeletedByAge} rssDeletedByPerSourceCap=${result.rssDeletedByPerSourceCap} rssSourcesDeletedOrphaned=${result.rssSourcesDeletedOrphaned} rssItemsRemaining=${result.rssItemsRemaining} rssSourcesRemaining=${result.rssSourcesRemaining}`
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error(`[retention][${requestId}] fatal error`, error);
    return NextResponse.json({ error: "Retention execution failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
