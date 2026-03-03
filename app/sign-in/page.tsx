"use client";

import { signIn } from "next-auth/react";

export default function SignInPage() {
  return (
    <main style={{ maxWidth: 560, margin: "80px auto", padding: 20 }}>
      <h1 style={{ fontSize: 28, margin: 0, letterSpacing: -0.4 }}>
        Cluck&#39;s Feed
      </h1>
      <p style={{ color: "var(--muted)", marginTop: 8 }}>
        A calm, focused way to read newsletters. Your inbox becomes a clean,
        article-like feed with keyboard shortcuts and gentle reading flow.
      </p>
      <button
        onClick={() => signIn("google", { callbackUrl: "/inbox" })}
        style={{
          marginTop: 12,
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
