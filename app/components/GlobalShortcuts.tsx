"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isTypingTarget } from "@/app/inbox/lib/client-utils";

function inferInboxPath(pathname: string): string {
  if (
    pathname.startsWith("/rss") ||
    pathname.startsWith("/source/") ||
    pathname.startsWith("/inbox/rss")
  ) {
    return "/inbox/rss";
  }
  return "/inbox/newsletters";
}

export function GlobalShortcuts() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key !== "b") return;
      if (pathname.startsWith("/read/")) return;

      event.preventDefault();
      const destination = inferInboxPath(pathname);
      if (pathname !== destination) {
        router.push(destination);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pathname, router]);

  return null;
}
