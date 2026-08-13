"use client";

import { SessionProvider } from "next-auth/react";
import { GlobalShortcuts } from "./components/GlobalShortcuts";
import { SessionErrorHandler } from "./components/SessionErrorHandler";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <GlobalShortcuts />
      <SessionErrorHandler />
      {children}
    </SessionProvider>
  );
}
