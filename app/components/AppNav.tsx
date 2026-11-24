"use client";

import Link from "next/link";

type Section = "today" | "newsletters" | "saved" | "highlights" | "settings";
type Tab = "today" | "newsletters" | "saved";

/**
 * The app's one navigation. On a phone it's the bottom tab bar (thumb
 * reach); on a wide screen the same links become a left sidebar, so the
 * desktop layout isn't a phone column with a toolbar stretched across the
 * whole window.
 *
 * Today, Newsletters and Saved are views of the Today page; when that page passes
 * `onTab`, switching between them is instant instead of a navigation.
 */
export function AppNav({
  active,
  onTab,
  desktopOnly = false,
}: {
  active: Section;
  onTab?: (tab: Tab) => void;
  /** The reader has its own phone toolbar, so it only wants the desktop sidebar. */
  desktopOnly?: boolean;
}) {
  const tabLink = (tab: Tab, label: string) =>
    onTab ? (
      <button type="button" className={active === tab ? "active" : ""} onClick={() => onTab(tab)}>
        {label}
      </button>
    ) : (
      <Link href={tab === "today" ? "/today" : `/today?tab=${tab}`} className={active === tab ? "active" : ""}>
        {label}
      </Link>
    );

  return (
    <nav className={desktopOnly ? "app-nav app-nav-desktop-only" : "app-nav"} aria-label="Sections">
      <span className="app-nav-brand">Cluck&#39;s Feed</span>
      {tabLink("today", "Today")}
      {tabLink("newsletters", "Newsletters")}
      {tabLink("saved", "Saved")}
      <Link href="/highlights" className={active === "highlights" ? "active" : ""}>
        Highlights
      </Link>
      <Link href="/settings" className={active === "settings" ? "active" : ""}>
        Settings
      </Link>
    </nav>
  );
}
