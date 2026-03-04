import { NextResponse } from "next/server";

// Retention endpoint disabled — articles are kept indefinitely as a searchable archive.
export async function GET() {
  return NextResponse.json({ ok: true, message: "Retention policies removed." });
}

export async function POST() {
  return NextResponse.json({ ok: true, message: "Retention policies removed." });
}
