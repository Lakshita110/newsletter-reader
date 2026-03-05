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
  onMarkRead: (id: string) => void;
};

export function useFeedKeyboardNavigation({
  ordered,
  activeSelectedIndex,
  setSelectedIndex,
  onOpen,
  onMarkRead,
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
        onMarkRead(current.id);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSelectedIndex, onMarkRead, onOpen, ordered, router, setSelectedIndex]);

  useEffect(() => {
    const current = ordered[activeSelectedIndex];
    if (!current) return;
    const selector = `[data-feed-item-id="${escapeSelectorValue(current.id)}"]`;
    const el = document.querySelector<HTMLElement>(selector);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeSelectedIndex, ordered]);
}
