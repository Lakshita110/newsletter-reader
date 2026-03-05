"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FeedList } from "@/app/inbox/components/FeedList";
import { enrichItems, groupItemsByDay } from "@/app/inbox/lib/derive";
import { readMapFromStorage, saveMapToStorage, toReadStatusMap } from "@/app/inbox/lib/client-utils";
import { buildContextById, postReadState } from "@/app/inbox/lib/read-state";
import type { FeedReadStatus, InboxItem } from "@/app/inbox/types";

type SourcePayload = {
  source?: { id: string; name: string; dailyCap: number };
  items?: InboxItem[];
};

export default function SourcePage() {
  const params = useParams();
  const sourceId = typeof params?.sourceId === "string" ? params.sourceId : "";
  const { data: session } = useSession();
  const [data, setData] = useState<SourcePayload>({});
  const [statusById, setStatusById] = useState<Record<string, FeedReadStatus>>(() =>
    readMapFromStorage<FeedReadStatus>("nr_read_status_map")
  );
  const [savedById, setSavedById] = useState<Record<string, boolean>>(() =>
    readMapFromStorage<boolean>("nr_saved_items_map")
  );

  useEffect(() => {
    if (!sourceId) return;
    (async () => {
      const res = await fetch(`/api/feed/source/${sourceId}`);
      const json = await res.json();
      setData(json);
    })();
  }, [sourceId]);

  useEffect(() => {
    if (!session?.user?.email) return;
    (async () => {
      const res = await fetch("/api/read-state");
      if (!res.ok) return;
      setStatusById(toReadStatusMap(await res.json()));
    })();
  }, [session?.user?.email]);

  useEffect(() => {
    saveMapToStorage("nr_read_status_map", statusById);
  }, [statusById]);

  useEffect(() => {
    saveMapToStorage("nr_saved_items_map", savedById);
  }, [savedById]);

  const items = useMemo(() => (Array.isArray(data.items) ? data.items : []), [data.items]);
  const grouped = useMemo(() => groupItemsByDay(enrichItems(items)), [items]);
  const ordered = useMemo(() => grouped.flatMap((group) => group.items), [grouped]);
  const contextById = useMemo(() => buildContextById(items, "rss"), [items]);

  const markInProgress = useCallback(
    (id: string) => {
      setStatusById((prev) => (prev[id] === "read" ? prev : { ...prev, [id]: "in-progress" }));
      postReadState({ messageId: id, state: "in_progress", metadata: contextById[id] }).catch(() => null);
    },
    [contextById]
  );

  const markRead = useCallback(
    (id: string) => {
      setStatusById((prev) => ({ ...prev, [id]: "read" }));
      postReadState({ messageId: id, state: "read", metadata: contextById[id] }).catch(() => null);
    },
    [contextById]
  );

  useEffect(() => {
    window.localStorage.setItem(
      "nr_ordered_items",
      JSON.stringify(ordered.map((it) => ({ id: it.id, subject: it.subject || "(No subject)" })))
    );
  }, [ordered]);

  return (
    <main style={{ maxWidth: 780, margin: "44px auto", padding: 20 }}>
      <div style={{ marginBottom: 12 }}>
        <Link href="/inbox/rss" style={{ color: "var(--muted)", fontSize: 13 }}>
          Back to inbox
        </Link>
      </div>
      <h1 style={{ margin: "0 0 8px" }}>{data.source?.name ?? "Source"}</h1>
      <div style={{ color: "var(--muted)", marginBottom: 16, fontSize: 13 }}>
        Showing all items. Main daily feed cap for this source: {data.source?.dailyCap ?? 0}
      </div>

      <FeedList
        grouped={grouped}
        ordered={ordered}
        selectedIndex={0}
        statusById={statusById}
        savedById={savedById}
        onOpen={markInProgress}
        onMarkRead={markRead}
        onToggleSaved={(id) => setSavedById((prev) => ({ ...prev, [id]: !prev[id] }))}
      />
    </main>
  );
}
