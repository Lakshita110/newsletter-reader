import Link from "next/link";
import { formatDateTime } from "../lib/date";
import type { EnrichedInboxItem, GroupedInboxItems } from "../types";

export function FeedList({
  grouped,
  ordered,
  selectedIndex,
  readIds,
  onMarkRead,
}: {
  grouped: GroupedInboxItems[];
  ordered: EnrichedInboxItem[];
  selectedIndex: number;
  readIds: Set<string>;
  onMarkRead: (id: string) => void;
}) {
  return (
    <section>
      {grouped.map((group) => (
        <div key={group.key} style={{ marginBottom: 18 }}>
          <div
            style={{
              fontSize: 13,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: 0.6,
              marginBottom: 6,
            }}
          >
            {group.label}
          </div>
          {group.items.map((it) => {
            const isSelected = ordered[selectedIndex]?.id === it.id;
            const isRead = readIds.has(it.id);
            return (
              <Link
                key={it.id}
                href={`/read/${it.id}`}
                onClick={() => onMarkRead(it.id)}
                className="feed-item"
                style={{
                  display: "block",
                  padding: "14px 10px",
                  borderBottom: "1px solid var(--faint)",
                  borderRadius: 10,
                  background: isSelected ? "#f8f9ff" : "transparent",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {!isRead && (
                      <span
                        aria-label="Unread"
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 999,
                          background: "var(--accent-blue)",
                          display: "inline-block",
                        }}
                      />
                    )}
                    <div
                      style={{
                        fontSize: 17,
                        fontWeight: 500,
                        letterSpacing: -0.2,
                        opacity: isRead ? 0.7 : 1,
                      }}
                    >
                      {it.subject || "(No subject)"}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 6,
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    opacity: isRead ? 0.7 : 1,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      padding: "2px 8px",
                      borderRadius: 6,
                      background: "#f1f5ff",
                      color: "var(--accent-blue)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {it.publicationName}
                  </span>
                  <span style={{ color: "var(--muted)", fontSize: 12, whiteSpace: "nowrap" }}>
                    {formatDateTime(it.date)}
                  </span>
                </div>

                {it.snippet && (
                  <div
                    style={{
                      marginTop: 8,
                      color: "var(--muted)",
                      fontSize: 14,
                      lineHeight: 1.45,
                      opacity: isRead ? 0.7 : 1,
                    }}
                  >
                    {it.snippet}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </section>
  );
}
