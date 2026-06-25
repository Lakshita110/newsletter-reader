"use client";

import { signIn } from "next-auth/react";

export default function SignInPage() {
  const features = [
    {
      title: "Newsletters + RSS in one place",
      body: "Read your Gmail newsletters and subscribed RSS feeds in the same clean, article-like flow — no digging through your mailbox.",
    },
    {
      title: "A ranked set for today",
      body: "Each day you get a focused list of your best unread RSS picks, ranked for you with optional AI ranking.",
    },
    {
      title: "Built for reading",
      body: "Keyboard shortcuts, read-progress tracking, save-for-later, and reading streaks to keep the habit going.",
    },
    {
      title: "Optional daily digest",
      body: "Have your top picks delivered to your inbox each morning, on your schedule.",
    },
  ];

  return (
    <main style={{ maxWidth: 560, margin: "80px auto", padding: 20 }}>
      <h1 style={{ fontSize: 28, margin: 0, letterSpacing: -0.4 }}>
        Cluck&#39;s Feed
      </h1>
      <p style={{ color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>
        Your newsletters and RSS feeds, together in one calm,
        keyboard-friendly reading inbox.
      </p>

      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "20px 0 0",
          display: "grid",
          gap: 14,
        }}
      >
        {features.map((feature) => (
          <li key={feature.title}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{feature.title}</div>
            <div style={{ color: "var(--muted)", marginTop: 2, lineHeight: 1.5 }}>
              {feature.body}
            </div>
          </li>
        ))}
      </ul>

      <button
        onClick={() => signIn("google", { callbackUrl: "/inbox" })}
        style={{
          marginTop: 24,
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid var(--faint)",
          background: "var(--surface-accent)",
          color: "var(--accent-blue)",
          cursor: "pointer",
        }}
      >
        Sign in with Google
      </button>
    </main>
  );
}
