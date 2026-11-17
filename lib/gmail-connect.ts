import { randomBytes, timingSafeEqual } from "crypto";

/**
 * "Use a different Gmail": connect a mailbox to the signed-in account without
 * changing who is signed in. The app login (NextAuth) can't do this, because
 * signing in with another Google account means becoming another app user,
 * with none of your sources, saved items or highlights.
 *
 * This is a plain OAuth code flow just for the Gmail scope. Its redirect URI
 * (/api/gmail/callback) has to be listed in the Google Cloud OAuth client.
 */
export const GMAIL_CONNECT_SCOPE = "openid email https://www.googleapis.com/auth/gmail.readonly";
export const STATE_COOKIE = "gmail_connect_state";

export function appBaseUrl(requestUrl: string): string {
  // NEXTAUTH_URL is the canonical public URL; the request origin is the fallback (previews, local dev).
  return (process.env.NEXTAUTH_URL || new URL(requestUrl).origin).replace(/\/+$/, "");
}

export function redirectUri(requestUrl: string): string {
  return `${appBaseUrl(requestUrl)}/api/gmail/callback`;
}

export function newState(): string {
  return randomBytes(24).toString("base64url");
}

/** Constant-time compare, so the CSRF state can't be guessed byte by byte. */
export function statesMatch(expected: string | undefined, actual: string | null): boolean {
  if (!expected || !actual) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function googleAuthUrl(requestUrl: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(requestUrl),
    response_type: "code",
    scope: GMAIL_CONNECT_SCOPE,
    access_type: "offline",
    // consent: Google only issues a refresh token on the consent screen.
    // select_account: the point is picking a *different* Google account.
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}
