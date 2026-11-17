"use client";

import { SessionProvider } from "next-auth/react";
import { GlobalShortcuts } from "./components/GlobalShortcuts";
import { ServiceWorkerRegister } from "./components/ServiceWorkerRegister";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <GlobalShortcuts />
      <ServiceWorkerRegister />
      {children}
    </SessionProvider>
  );
}
