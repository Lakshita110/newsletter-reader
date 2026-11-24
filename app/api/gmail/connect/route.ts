import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session-user";
import { STATE_COOKIE, appBaseUrl, googleAuthUrl, newState } from "@/lib/gmail-connect";

export const dynamic = "force-dynamic";

/** Start "Use a different Gmail": send her to Google's account picker. */
export async function GET(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.redirect(`${appBaseUrl(req.url)}/sign-in`);
  const state = newState();
  const res = NextResponse.redirect(googleAuthUrl(req.url, state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax", // sent on Google's top-level redirect back to us
    path: "/api/gmail",
    maxAge: 600,
  });
  return res;
}
