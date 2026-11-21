"use client";

import { useEffect, useState } from "react";

type Account = { id: string; email: string | null; connected: boolean; error: string | null };

/** Read once from ?gmail=… after coming back from Google's account picker. */
function readConnectResult(): string | null {
  if (typeof window === "undefined") return null;
  const result = new URLSearchParams(window.location.search).get("gmail");
  if (result === "connected") return "Mailbox connected. Its newsletters from the last 30 days will show up shortly.";
  if (result === "cancelled") return "Nothing was changed.";
  if (result === "error") return "Couldn't connect that account. Please try again.";
  return null;
}

/**
 * Every Gmail inbox newsletters are pulled from. Each one is independent:
 * adding, reconnecting or removing one never touches the others, and
 * removing a mailbox keeps the issues already pulled from it.
 */
export default function MailboxesSection() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [notice, setNotice] = useState<string | null>(readConnectResult);

  const load = () =>
    fetch("/api/gmail/status", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then((body: { accounts: Account[] }) => setAccounts(body.accounts))
      .catch((err: unknown) => {
        console.error("[settings] mailbox list failed", err);
        setNotice("Couldn't load your mailboxes.");
      });

  useEffect(() => {
    load();
  }, []);

  const remove = async (account: Account) => {
    const res = await fetch(`/api/gmail/accounts/${encodeURIComponent(account.id)}`, { method: "DELETE" });
    if (!res.ok) setNotice("Couldn't remove that mailbox.");
    await load();
  };

  return (
    <section className="settings-card">
      <h2 className="settings-card-title">Mailboxes</h2>
      {notice && <p className="settings-note">{notice}</p>}
      <ul className="settings-list">
        {accounts?.length === 0 && (
          <li className="settings-note">No mailbox connected, so new newsletters aren&apos;t coming in.</li>
        )}
        {accounts?.map((account) => (
          <li key={account.id}>
            <span className="settings-list-name">
              {account.email ?? "Gmail (address appears after the next sync)"}
              {!account.connected && <span className="settings-warn">access expired</span>}
            </span>
            {!account.connected && (
              // Plain links: these leave the app for Google's account picker and come back here.
              <a href="/api/gmail/connect" className="settings-link-btn">
                Reconnect
              </a>
            )}
            <button type="button" className="settings-link-btn" onClick={() => remove(account)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <a href="/api/gmail/connect" className="filter-action-btn settings-add-link">
        + Add a Gmail account
      </a>
    </section>
  );
}
