import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/token-crypto";

/**
 * Gmail access for newsletter sync, one GmailAccount row per mailbox.
 *
 * Sign-in and Gmail are independent: signing in only proves who you are, and
 * each mailbox keeps its own encrypted refresh token. Losing access to one
 * mailbox (revoked, or Google's 7-day expiry for apps in Testing mode) marks
 * just that account for reconnecting; the others and everything already
 * stored keep working.
 */

type CachedToken = { accessToken: string; expiresAt: number };
// Per server instance, keyed by GmailAccount id. Saves a Google round-trip on
// every request; access tokens last an hour.
const accessTokenCache = new Map<string, CachedToken>();

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

export type GmailAccountStatus = { id: string; email: string | null; connected: boolean; error: string | null };

/**
 * Called on sign-in when Google returned a refresh token. Creates the user if
 * needed, and connects the sign-in mailbox only when it is already one of
 * her mailboxes or she has none yet, so removing it in Settings sticks.
 * Returns the user's id.
 */
export async function saveLoginGmailToken(email: string, refreshToken: string): Promise<string> {
  const user = await prisma.user.upsert({ where: { email }, update: {}, create: { email }, select: { id: true } });
  const accounts = await prisma.gmailAccount.findMany({ where: { userId: user.id }, select: { email: true } });
  if (accounts.length === 0 || accounts.some((a) => a.email === email)) {
    await prisma.gmailAccount.upsert({
      where: { userId_email: { userId: user.id, email } },
      update: { refreshTokenEnc: encryptSecret(refreshToken), tokenError: null },
      create: { userId: user.id, email, refreshTokenEnc: encryptSecret(refreshToken) },
    });
  }
  return user.id;
}

/**
 * Add (or reconnect) a mailbox chosen with "Add a Gmail account". Resets its
 * sync cursor so the mailbox's last 30 days are read.
 */
export async function connectGmailAccount(
  userId: string,
  email: string,
  refreshToken: string,
  accessToken: string,
  expiresInMs: number
): Promise<void> {
  const data = { email, refreshTokenEnc: encryptSecret(refreshToken), tokenError: null, syncedAt: null };
  const existing = await prisma.gmailAccount.findUnique({
    where: { userId_email: { userId, email } },
    select: { id: true },
  });
  // The mailbox carried over from the single-mailbox days may have no address
  // recorded (it's filled in on the first successful sync). If its access
  // died before that, reconnecting must claim that row: creating a second
  // one left the old row stuck as an unnamed, expired mailbox forever.
  const unnamed = existing
    ? null
    : await prisma.gmailAccount.findFirst({ where: { userId, email: null }, select: { id: true } });
  const target = existing ?? unnamed;
  const account = target
    ? await prisma.gmailAccount.update({ where: { id: target.id }, data, select: { id: true } })
    : await prisma.gmailAccount.create({ data: { userId, ...data }, select: { id: true } });
  accessTokenCache.set(account.id, { accessToken, expiresAt: Date.now() + expiresInMs });
}

export async function removeGmailAccount(userId: string, accountId: string): Promise<boolean> {
  accessTokenCache.delete(accountId);
  const res = await prisma.gmailAccount.deleteMany({ where: { id: accountId, userId } });
  return res.count > 0;
}

export async function listGmailAccounts(userId: string): Promise<GmailAccountStatus[]> {
  const rows = await prisma.gmailAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, refreshTokenEnc: true, tokenError: true },
  });
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    connected: Boolean(row.refreshTokenEnc),
    error: row.tokenError,
  }));
}

async function markDisconnected(accountId: string, reason: string) {
  accessTokenCache.delete(accountId);
  await prisma.gmailAccount.update({
    where: { id: accountId },
    data: { refreshTokenEnc: null, tokenError: reason },
  });
}

/**
 * A usable access token for this mailbox, or null when it isn't connected
 * (revoked or expired). Null is an expected state the UI turns into a
 * "Reconnect" prompt, so failures are logged and recorded rather than thrown.
 */
export async function getGmailAccessToken(accountId: string): Promise<string | null> {
  const cached = accessTokenCache.get(accountId);
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.accessToken;

  const row = await prisma.gmailAccount.findUnique({ where: { id: accountId }, select: { refreshTokenEnc: true } });
  if (!row?.refreshTokenEnc) return null;

  let refreshToken: string;
  try {
    refreshToken = decryptSecret(row.refreshTokenEnc);
  } catch (error) {
    // Most likely NEXTAUTH_SECRET was rotated. The stored token is useless
    // now, so drop it and ask for a reconnect instead of failing forever.
    console.error(`[gmail-token] cannot decrypt stored refresh token for account ${accountId}`, error);
    await markDisconnected(accountId, "undecryptable");
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
      `[gmail-token] refresh failed for account ${accountId}: status=${res.status} error=${data.error ?? "unknown"} ${data.error_description ?? ""}`
    );
    // invalid_grant = revoked, or expired (Google expires refresh tokens after
    // 7 days while the OAuth app is in Testing mode). Retrying won't help.
    if (data.error === "invalid_grant") await markDisconnected(accountId, "invalid_grant");
    return null;
  }

  if (data.refresh_token && data.refresh_token !== refreshToken) {
    await prisma.gmailAccount.update({
      where: { id: accountId },
      data: { refreshTokenEnc: encryptSecret(data.refresh_token) },
    });
  }
  const accessToken = data.access_token;
  accessTokenCache.set(accountId, { accessToken, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 });
  return accessToken;
}

/** Test hook. */
export function clearGmailTokenCacheForTests() {
  accessTokenCache.clear();
}
