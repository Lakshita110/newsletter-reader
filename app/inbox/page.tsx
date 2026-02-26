"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function InboxPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/inbox/newsletters");
  }, [router]);

  return (
    <main style={{ maxWidth: 560, margin: "80px auto", padding: 20 }}>
      <p>Redirecting to newsletters...</p>
    </main>
  );
}

