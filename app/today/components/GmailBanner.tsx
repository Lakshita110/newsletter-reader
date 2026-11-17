"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";

type Status = { connected: boolean; error: string | null };

/**
 * Shown only when new newsletters can't be pulled from Gmail. It replaces the
 * old behaviour of bouncing the whole app back to Google: everything already
 * stored stays readable, and reconnecting is one deliberate tap.
 */
export function GmailBanner({ enabled }: { enabled: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/gmail/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: Status | null) => {
        if (!cancelled && body) setStatus(body);
      })
      .catch((err: unknown) => console.error("[today] gmail status check failed", err));
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!status || status.connected) return null;
  return (
    <div className="today-banner today-gmail-banner">
      <span>
        {status.error
          ? "Gmail access expired, so new newsletters aren't coming in."
          : "Connect Gmail to pull in your newsletters."}
      </span>
      <button
        type="button"
        // Consent is required here: it's the only way Google issues the
        // refresh token that keeps Gmail syncing without further sign-ins.
        onClick={() => signIn("google", { callbackUrl: "/today" }, { prompt: "consent" })}
      >
        {status.error ? "Reconnect" : "Connect"}
      </button>
    </div>
  );
}
