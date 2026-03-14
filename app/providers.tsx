"use client";

import { SessionProvider } from "next-auth/react";
import { GlobalShortcuts } from "./components/GlobalShortcuts";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <GlobalShortcuts />
      {children}
    </SessionProvider>
  );
}
