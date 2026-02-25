"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/inbox");
  }, [router]);

  return (
    <main style={{ padding: 24 }}>
      <p>Redirecting to inbox...</p>
    </main>
  );
}
