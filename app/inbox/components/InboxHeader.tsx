"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";

type Props = {
  todayCount: number;
  mode: "newsletters" | "rss";
  userEmail?: string | null;
  q: string;
  onQueryChange: (value: string) => void;
  profileLinks?: { label: string; href: string }[];
};

export function InboxHeader({
  todayCount,
  mode,
  userEmail,
  q,
  onQueryChange,
  profileLinks = [],
}: Props) {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showShortcuts && !showProfileMenu) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!showProfileMenu) return;
      const target = event.target as Node | null;
      if (target && profileMenuRef.current?.contains(target)) return;
      setShowProfileMenu(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowShortcuts(false);
      setShowProfileMenu(false);
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showProfileMenu, showShortcuts]);

  return (
    <header className="masthead-surface" style={{ marginBottom: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div>
          <h1 className="app-page-title masthead-title">Cluck&apos;s Feed</h1>
          <div className="app-page-subtitle" style={{ marginTop: 4 }}>
            {mode === "rss" ? `${todayCount} RSS articles today` : `${todayCount} newsletters today`}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <button
            type="button"
            className="header-icon-btn"
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
            onClick={() => setShowShortcuts(true)}
          >
            ?
          </button>
          <div ref={profileMenuRef} style={{ position: "relative" }}>
            <button
              type="button"
              className="header-profile-btn"
              title="Profile and account menu"
              aria-label="Profile and account menu"
              onClick={() => setShowProfileMenu((prev) => !prev)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 21a8 8 0 1 0-16 0" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>Profile</span>
            </button>

            {showProfileMenu && (
              <div className="account-menu">
                {userEmail && <div className="account-menu-email">{userEmail}</div>}
                {profileLinks.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="account-menu-link"
                    onClick={() => setShowProfileMenu(false)}
                  >
                    {item.label}
                  </Link>
                ))}
                <button
                  type="button"
                  className="account-menu-link"
                  onClick={() => signOut({ callbackUrl: "/" })}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          value={q}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search subject, sender, snippet..."
          aria-label="Search inbox"
          style={{
            flex: "1 1 320px",
            background: "var(--surface)",
            border: "1px solid var(--faint)",
            color: "var(--text)",
            padding: "10px 12px",
            borderRadius: 10,
            outline: "none",
          }}
        />
      </div>

      {showShortcuts && (
        <div className="modal-overlay" onClick={() => setShowShortcuts(false)}>
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-title-row">
              <h2 className="modal-title">Keyboard shortcuts</h2>
              <button
                type="button"
                className="header-icon-btn"
                onClick={() => setShowShortcuts(false)}
                aria-label="Close shortcuts"
                title="Close"
              >
                x
              </button>
            </div>
            <ul className="shortcut-list">
              <li>
                <code>j</code> or <code>Arrow Down</code> - Move down
              </li>
              <li>
                <code>k</code> or <code>Arrow Up</code> - Move up
              </li>
              <li>
                <code>Enter</code> or <code>o</code> - Open item
              </li>
              <li>
                <code>r</code> - Mark item as read
              </li>
              <li>
                <code>u</code> - Back to inbox from reader
              </li>
              <li>
                <code>Esc</code> - Close this modal
              </li>
            </ul>
          </section>
        </div>
      )}
    </header>
  );
}
