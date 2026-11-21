import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session-user";
import { STATE_COOKIE, appBaseUrl, redirectUri, statesMatch } from "@/lib/gmail-connect";
import { google } from "googleapis";
import { connectGmailAccount } from "@/lib/gmail-token";

export const dynamic = "force-dynamic";

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };

/**
 * Google redirects back here with a code. Exchange it and add the picked
 * mailbox to the *signed-in* user's accounts (or refresh it if it's already
 * there), whichever Google account was picked.
 */
export async function GET(req: Request) {
  const base = appBaseUrl(req.url);
  const done = (result: string) => {
    const res = NextResponse.redirect(`${base}/settings?gmail=${result}`);
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/gmail" });
    return res;
  };

  const userId = await getSessionUserId();
  if (!userId) return NextResponse.redirect(`${base}/sign-in`);

  const params = new URL(req.url).searchParams;
  const expected = (await cookies()).get(STATE_COOKIE)?.value;
  if (!statesMatch(expected, params.get("state"))) {
    console.warn("[gmail-connect] state mismatch; ignoring callback");
    return done("error");
  }
  const code = params.get("code");
  if (!code) return done(params.get("error") === "access_denied" ? "cancelled" : "error");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri(req.url),
      grant_type: "authorization_code",
    }),
  });
  const data = (await tokenRes.json().catch(() => ({}))) as TokenResponse;
  if (!tokenRes.ok || !data.refresh_token || !data.access_token) {
    console.error(
      `[gmail-connect] token exchange failed: status=${tokenRes.status} error=${data.error ?? "no refresh token"}`
    );
    return done("error");
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: data.access_token });
  const profile = await google
    .gmail({ version: "v1", auth })
    .users.getProfile({ userId: "me" })
    .catch((error) => {
      console.error("[gmail-connect] could not read the new mailbox's address", error);
      return null;
    });
  const email = profile?.data.emailAddress?.toLowerCase();
  if (!email) return done("error");

  await connectGmailAccount(userId, email, data.refresh_token, data.access_token, (data.expires_in ?? 3600) * 1000);
  return done("connected");
}
