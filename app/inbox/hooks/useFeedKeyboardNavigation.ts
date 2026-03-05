import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { InboxItem } from "../types";
import { escapeSelectorValue, isTypingTarget } from "../lib/client-utils";

import type { Dispatch, SetStateAction } from "react";

type Params = {
  ordered: InboxItem[];
  activeSelectedIndex: number;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
  onOpen: (id: string) => void;
  onToggleRead: (id: string) => void;
  onToggleSaved: (id: string) => void;
  onOpenExternal?: (url: string) => void;
};

export function useFeedKeyboardNavigation({
  ordered,
  activeSelectedIndex,
  setSelectedIndex,
  onOpen,
  onToggleRead,
  onToggleSaved,
  onOpenExternal,
}: Params) {
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || ordered.length === 0) return;

      if (event.key === "j" || event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, ordered.length - 1));
        return;
      }

      if (event.key === "k" || event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }

      const current = ordered[activeSelectedIndex];
      if (!current) return;

      if (event.key === "o" || event.key === "Enter") {
        event.preventDefault();
        onOpen(current.id);
        router.push(`/read/${current.id}`);
      } else if (event.key === "r") {
        event.preventDefault();
        onToggleRead(current.id);
      } else if (event.key === "s") {
        event.preventDefault();
        onToggleSaved(current.id);
      } else if (event.key === "f") {
        if (current.externalUrl) {
          event.preventDefault();
          if (onOpenExternal) {
            onOpenExternal(current.externalUrl);
            return;
          }
          window.open(current.externalUrl, "_blank", "noopener,noreferrer");
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeSelectedIndex,
    onOpen,
    onOpenExternal,
    onToggleRead,
    onToggleSaved,
    ordered,
    router,
    setSelectedIndex,
  ]);

  useEffect(() => {
    const current = ordered[activeSelectedIndex];
    if (!current) return;
    const selector = `[data-feed-item-id="${escapeSelectorValue(current.id)}"]`;
    const el = document.querySelector<HTMLElement>(selector);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeSelectedIndex, ordered]);
}
