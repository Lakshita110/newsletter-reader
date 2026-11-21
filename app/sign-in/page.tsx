"use client";

import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Suspense } from "react";

/** A personal app: no feature pitch, just the way back in. */
function SignIn() {
  const error = useSearchParams().get("error");
  return (
    <main style={{ maxWidth: 420, margin: "120px auto", padding: 20, textAlign: "center" }}>
      <h1 style={{ fontSize: 32, margin: 0, letterSpacing: -0.4 }}>Cluck&#39;s Feed</h1>
      {error === "AccessDenied" && (
        <p style={{ color: "var(--danger-text, #c0392b)", marginTop: 16, lineHeight: 1.5 }}>
          That Google account isn&#39;t the owner of this app. Sign in with the account you normally use.
        </p>
      )}
      <button
        onClick={() => signIn("google", { callbackUrl: "/today" })}
        style={{
          marginTop: 24,
          padding: "12px 18px",
          borderRadius: 12,
          border: "1px solid var(--faint)",
          background: "var(--surface-accent)",
          color: "var(--accent-blue)",
          fontSize: 16,
          cursor: "pointer",
        }}
      >
        Sign in with Google
      </button>
    </main>
  );
}

export default function SignInPage() {
  // useSearchParams needs a Suspense boundary for static prerendering.
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
