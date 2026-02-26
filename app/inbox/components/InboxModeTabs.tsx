import Link from "next/link";

export function InboxModeTabs({ mode }: { mode: "newsletters" | "rss" }) {
  return (
    <nav className="inbox-tabs" aria-label="Inbox sections">
      <Link
        href="/inbox/newsletters"
        className={mode === "newsletters" ? "inbox-tab active" : "inbox-tab"}
      >
        Newsletters
      </Link>
      <Link href="/inbox/rss" className={mode === "rss" ? "inbox-tab active" : "inbox-tab"}>
        RSS Feed
      </Link>
    </nav>
  );
}
