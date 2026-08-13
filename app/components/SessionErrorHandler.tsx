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
    if (session?.error === "RefreshAccessTokenError" || session?.error === "MissingRefreshToken") {
      signIn("google");
    }
  }, [session?.error]);

  return null;
}
