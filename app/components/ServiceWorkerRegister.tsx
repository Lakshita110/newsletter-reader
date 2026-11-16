"use client";

import { useEffect } from "react";

/** Registers public/sw.js (production only, so dev reloads never serve stale code). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("[sw] registration failed", error);
    });
  }, []);
  return null;
}
