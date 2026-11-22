"use client";

import { useEffect, useState } from "react";

type Account = { id: string; email: string | null; connected: boolean };

/**
 * Shown only when a mailbox can't be read, so its new newsletters aren't
 * coming in. Everything already stored stays readable; reconnecting is one
 * deliberate tap through Google's account picker.
 */
export function GmailBanner({ enabled }: { enabled: boolean }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/gmail/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { accounts: Account[] } | null) => {
        if (!cancelled && body) setAccounts(body.accounts);
      })
      .catch((err: unknown) => console.error("[today] gmail status check failed", err));
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!accounts) return null;
  const expired = accounts.filter((a) => !a.connected);
  if (accounts.length > 0 && expired.length === 0) return null;
  return (
    <div className="today-banner today-gmail-banner">
      <span>
        {accounts.length === 0
          ? "Connect Gmail to pull in your newsletters."
          : `Access to ${expired.map((a) => a.email ?? "your newsletter Gmail").join(", ")} expired, so its new newsletters aren't coming in.`}
      </span>
      <a href="/api/gmail/connect">{accounts.length === 0 ? "Connect" : "Reconnect"}</a>
    </div>
  );
}
