"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { AppNav } from "@/app/components/AppNav";
import RankingSection from "./components/RankingSection";
import MailboxesSection from "./components/MailboxesSection";
import FeedsSection from "./components/FeedsSection";
import NewsletterSendersSection from "./components/NewsletterSendersSection";
import SaveAnywhereSection from "./components/SaveAnywhereSection";

/**
 * One page, three things she actually changes: what gets picked, which
 * mailboxes newsletters come from, and which feeds stories come from.
 * Rarely-touched setup (extra newsletter senders, the save-from-anywhere
 * shortcut) is folded away so it doesn't crowd the everyday controls.
 */
export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/sign-in");
  }, [status, router]);

  return (
    <main className="today-shell settings-shell">
      <header className="today-header">
        <div>
          <h1 className="today-title">Settings</h1>
          <p className="today-subtitle">What gets picked, and where it comes from.</p>
        </div>
      </header>

      {session ? (
        <div className="settings-stack">
          <RankingSection />
          <MailboxesSection />
          <FeedsSection />

          <details className="settings-card settings-more">
            <summary className="settings-card-title">More newsletter senders</summary>
            <NewsletterSendersSection />
          </details>

          <details className="settings-card settings-more">
            <summary className="settings-card-title">Save from anywhere</summary>
            <SaveAnywhereSection />
          </details>
        </div>
      ) : (
        <p className="today-subtitle">Loading…</p>
      )}

      <AppNav active="settings" />
    </main>
  );
}
