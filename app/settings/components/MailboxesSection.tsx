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
    <section style={{ marginBottom: 18, borderBottom: "1px solid var(--faint)", paddingBottom: 16 }}>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>Mailboxes</div>
      {notice && <p style={{ fontSize: 13, margin: "0 0 8px" }}>{notice}</p>}
      <ul style={{ listStyle: "none", margin: "0 0 10px", padding: 0, display: "grid", gap: 8 }}>
        {accounts?.length === 0 && (
          <li style={{ fontSize: 13 }}>No mailbox connected, so new newsletters aren&apos;t coming in.</li>
        )}
        {accounts?.map((account) => (
          <li
            key={account.id}
            style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 14 }}
          >
            <span style={{ overflowWrap: "anywhere", flex: 1, minWidth: 180 }}>
              {account.email ?? "Gmail (address appears after the next sync)"}
              {!account.connected && (
                <span style={{ color: "var(--danger-text, #c0392b)", marginLeft: 8, fontSize: 13 }}>
                  access expired
                </span>
              )}
            </span>
            {!account.connected && (
              // Plain links: these leave the app for Google's account picker and come back here.
              <a href="/api/gmail/connect" className="btn-pill-sm btn-neutral" style={{ textDecoration: "none" }}>
                Reconnect
              </a>
            )}
            <button type="button" className="btn-pill-sm btn-danger" onClick={() => remove(account)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <a href="/api/gmail/connect" className="filter-action-btn" style={{ textDecoration: "none" }}>
        Add a Gmail account
      </a>
    </section>
  );
}
