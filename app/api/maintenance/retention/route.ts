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
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runRetentionNow();
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
