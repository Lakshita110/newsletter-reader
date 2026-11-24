import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session-user";
import { STATE_COOKIE, appBaseUrl, googleAuthUrl, newState } from "@/lib/gmail-connect";

export const dynamic = "force-dynamic";

/** Start "Use a different Gmail": send her to Google's account picker. */
export async function GET(req: Request) {
  // Google always sends her back to the canonical host (NEXTAUTH_URL). The
  // state cookie is host-scoped, so if she started on another host (an alias
  // or a preview URL) the callback would never see it and fail as a "state
  // mismatch". Bounce to the canonical host first so both ends share cookies.
  const base = appBaseUrl(req.url);
  if (new URL(req.url).origin !== new URL(base).origin) {
    return NextResponse.redirect(`${base}/api/gmail/connect`);
  }
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.redirect(`${base}/sign-in`);
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
