"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { InboxItem } from "@/app/inbox/types";
import { formatDateTime } from "@/app/inbox/lib/date";

type SourcePayload = {
  source?: { id: string; name: string };
  items?: InboxItem[];
};

export default function SourcePage() {
  const params = useParams();
  const sourceId = typeof params?.sourceId === "string" ? params.sourceId : "";
  const [data, setData] = useState<SourcePayload>({});

  useEffect(() => {
    if (!sourceId) return;
    (async () => {
      const res = await fetch(`/api/feed/source/${sourceId}`);
      const json = await res.json();
      setData(json);
    })();
  }, [sourceId]);

  const items = useMemo(() => (Array.isArray(data.items) ? data.items : []), [data.items]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "nr_ordered_items",
      JSON.stringify(
        items.map((it) => ({
          id: it.id,
          subject: it.subject || "(No subject)",
        }))
      )
    );
  }, [items]);

  return (
    <main style={{ maxWidth: 780, margin: "44px auto", padding: 20 }}>
      <div style={{ marginBottom: 12 }}>
        <Link href="/inbox" style={{ color: "var(--muted)", fontSize: 13 }}>
          Back to inbox
        </Link>
      </div>
      <h1 style={{ margin: "0 0 8px" }}>{data.source?.name ?? "Source"}</h1>
      <div style={{ color: "var(--muted)", marginBottom: 16, fontSize: 13 }}>
        Showing all recent items from this source.
      </div>

      <section>
        {items.map((it) => (
          <Link
            key={it.id}
            href={`/read/${it.id}`}
            className="feed-item"
            style={{
              display: "block",
              padding: "12px 10px",
              borderBottom: "1px solid var(--faint)",
              borderRadius: 10,
            }}
          >
            <div style={{ fontSize: 17, fontWeight: 500 }}>{it.subject || "(No subject)"}</div>
            <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 12 }}>
              {formatDateTime(it.date)}
            </div>
            {it.snippet && (
              <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 14 }}>{it.snippet}</div>
            )}
          </Link>
        ))}
      </section>
    </main>
  );
}
