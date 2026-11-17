import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";
import { primeGmailAccessToken, saveGmailRefreshToken } from "@/lib/gmail-token";

/**
 * Sign-in is just "who are you". Gmail access is handled separately in
 * lib/gmail-token.ts with a refresh token stored server-side, which is what
 * lets sign-in skip Google's consent screen:
 *
 * - No `prompt: "consent"`. Forcing it made every sign-in walk through the
 *   account chooser, the "unverified app" warning and the permissions page.
 *   Without it, Google only shows what it must: the full consent once, the
 *   first time, and after that usually a single account tap.
 * - Google only hands out a refresh token on consent, so we keep the one we
 *   get in the DB instead of needing a new one each sign-in.
 * - The session lasts a year, so the Home Screen app stays signed in. A
 *   Gmail problem no longer logs you out; Today shows "Reconnect Gmail".
 */
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

export const GMAIL_SCOPE = "openid email profile https://www.googleapis.com/auth/gmail.readonly";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: GMAIL_SCOPE,
          access_type: "offline",
        },
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: ONE_YEAR_SECONDS },
  callbacks: {
    async jwt({ token, account }) {
      const email = token.email;
      if (account && email) {
        // Present only when Google showed the consent screen (first sign-in
        // or "Reconnect Gmail"); otherwise the stored one stays in use.
        const userId = account.refresh_token
          ? await saveGmailRefreshToken(email, account.refresh_token)
          : (await prisma.user.upsert({ where: { email }, update: {}, create: { email }, select: { id: true } })).id;
        if (account.access_token) {
          primeGmailAccessToken(userId, account.access_token, (account.expires_at ?? Date.now() / 1000 + 3600) * 1000);
        }
        return { name: token.name, email, picture: token.picture, sub: token.sub };
      }

      // Cookies issued before this change carry the Google tokens inside the
      // JWT. Move the refresh token to the DB once and slim the cookie, so
      // nobody has to sign in again because of the switch.
      if (token.refreshToken && email) {
        await saveGmailRefreshToken(email, token.refreshToken);
        const { refreshToken: _r, accessToken: _a, accessTokenExpires: _e, error: _err, ...rest } = token;
        return rest;
      }
      return token;
    },
    async session({ session }) {
      return session;
    },
  },
};
