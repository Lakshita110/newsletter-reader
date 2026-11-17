import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/token-crypto";

/**
 * Gmail access, decoupled from the app login.
 *
 * Before: the Google refresh token lived only inside the NextAuth JWT cookie,
 * so (a) every sign-in had to force Google's consent screen to be sure a new
 * refresh token was issued, and (b) whenever that token stopped working the
 * whole app redirected back to Google. Now the refresh token is stored
 * (encrypted) on the User row the first time Google hands it over. Signing in
 * only proves who you are, and losing Gmail access just means "reconnect
 * Gmail" for new newsletters while everything already stored keeps working.
 */

type CachedToken = { accessToken: string; expiresAt: number };
// Per server instance. Saves a Google round-trip on every request; access
// tokens last an hour, so a cold instance costs one extra refresh at most.
const accessTokenCache = new Map<string, CachedToken>();

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

/** Returns the user's id (accounts are created lazily, so this may create the row). */
export async function saveGmailRefreshToken(email: string, refreshToken: string): Promise<string> {
  const row = await prisma.user.upsert({
    where: { email },
    update: { gmailRefreshTokenEnc: encryptSecret(refreshToken), gmailTokenError: null },
    create: { email, gmailRefreshTokenEnc: encryptSecret(refreshToken) },
    select: { id: true },
  });
  return row.id;
}

/** Seed the cache with the access token Google returned at sign-in, so the first page load needs no refresh. */
export function primeGmailAccessToken(userId: string, accessToken: string, expiresAtMs: number) {
  accessTokenCache.set(userId, { accessToken, expiresAt: expiresAtMs });
}

async function markDisconnected(userId: string, reason: string) {
  accessTokenCache.delete(userId);
  await prisma.user.update({
    where: { id: userId },
    data: { gmailRefreshTokenEnc: null, gmailTokenError: reason },
  });
}

/**
 * A usable Gmail access token for this user, or null when Gmail isn't
 * connected (never connected, revoked, or expired). Null is an expected state
 * the UI turns into a "Reconnect Gmail" prompt, so failures are logged and
 * recorded on the user rather than thrown.
 */
export async function getGmailAccessToken(userId: string): Promise<string | null> {
  const cached = accessTokenCache.get(userId);
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.accessToken;

  const row = await prisma.user.findUnique({ where: { id: userId }, select: { gmailRefreshTokenEnc: true } });
  if (!row?.gmailRefreshTokenEnc) return null;

  let refreshToken: string;
  try {
    refreshToken = decryptSecret(row.gmailRefreshTokenEnc);
  } catch (error) {
    // Most likely NEXTAUTH_SECRET was rotated. The stored token is useless
    // now, so drop it and ask for a reconnect instead of failing forever.
    console.error(`[gmail-token] cannot decrypt stored refresh token for user ${userId}`, error);
    await markDisconnected(userId, "undecryptable");
    return null;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as GoogleTokenResponse;

  if (!res.ok || !data.access_token) {
    console.warn(
      `[gmail-token] refresh failed for user ${userId}: status=${res.status} error=${data.error ?? "unknown"} ${data.error_description ?? ""}`
    );
    // invalid_grant = revoked, or expired (Google expires refresh tokens after
    // 7 days while the OAuth app is in Testing mode). Retrying won't help.
    if (data.error === "invalid_grant") await markDisconnected(userId, "invalid_grant");
    return null;
  }

  if (data.refresh_token && data.refresh_token !== refreshToken) {
    await prisma.user.update({
      where: { id: userId },
      data: { gmailRefreshTokenEnc: encryptSecret(data.refresh_token) },
    });
  }
  const accessToken = data.access_token;
  accessTokenCache.set(userId, { accessToken, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 });
  return accessToken;
}

export async function getGmailStatus(userId: string): Promise<{ connected: boolean; error: string | null }> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { gmailRefreshTokenEnc: true, gmailTokenError: true },
  });
  return { connected: Boolean(row?.gmailRefreshTokenEnc), error: row?.gmailTokenError ?? null };
}

/** Test hook. */
export function clearGmailTokenCacheForTests() {
  accessTokenCache.clear();
}
