"use client";

import { useEffect } from "react";
import { signIn, useSession } from "next-auth/react";

/**
 * Google refresh tokens occasionally stop working (e.g. token revoked, or
 * the OAuth app is in Testing mode where Google caps them at 7 days). When
 * that happens `lib/auth.ts` sets `session.error` but leaves `accessToken`
 * undefined instead of dropping the session outright, so without this the
 * app just silently fails to load Gmail data. Re-trigger sign-in
 * immediately so the user gets one clean Google redirect instead of a
 * broken inbox they have to notice and manually sign out of.
 */
export function SessionErrorHandler() {
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.error === "RefreshAccessTokenError") {
      // We already have a (now-rejected) refresh token on file, so the
      // full consent screen isn't needed to re-establish one — Google
      // will still issue a fresh refresh token on select_account as long
      // as access is still granted. select_account is a much faster
      // tap-through than the provider's default prompt=consent.
      signIn("google", undefined, { prompt: "select_account" });
    } else if (session?.error === "MissingRefreshToken") {
      // No refresh token was ever captured for this session, so we must
      // force the full consent screen to guarantee Google issues one.
      signIn("google", undefined, { prompt: "consent" });
    }
  }, [session?.error]);

  return null;
}
