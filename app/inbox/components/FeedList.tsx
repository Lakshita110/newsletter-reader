import Link from "next/link";
import { formatDateTime } from "../lib/date";
import type { EnrichedInboxItem, FeedReadStatus, GroupedInboxItems } from "../types";

export function FeedList({
  grouped,
  ordered,
  selectedIndex,
  statusById,
  onOpen,
  onMarkRead,
}: {
  grouped: GroupedInboxItems[];
  ordered: EnrichedInboxItem[];
  selectedIndex: number;
  statusById: Record<string, FeedReadStatus>;
  onOpen: (id: string) => void;
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
            const status = statusById[it.id] ?? "unread";
            const isRead = status === "read";
            const isInProgress = status === "in-progress";

            return (
              <Link
                key={it.id}
                href={`/read/${it.id}`}
                onClick={() => onOpen(it.id)}
                className="feed-item"
                style={{
                  display: "block",
                  padding: "14px 10px",
                  borderBottom: "1px solid var(--faint)",
                  borderRadius: 10,
                  background: isSelected ? "var(--surface-muted)" : "transparent",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    {status === "unread" && (
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
                    {isInProgress && (
                      <span
                        style={{
                          fontSize: 11,
                          padding: "1px 6px",
                          borderRadius: 999,
                          border: "1px solid var(--warning-border)",
                          color: "var(--warning-text)",
                          background: "var(--warning-bg)",
                        }}
                      >
                        In progress
                      </span>
                    )}
                    <div
                      style={{
                        fontSize: 17,
                        fontWeight: 500,
                        letterSpacing: -0.2,
                        opacity: isRead ? 0.65 : 1,
                        minWidth: 0,
                      }}
                    >
                      {it.subject || "(No subject)"}
                    </div>
                  </div>
                  {it.sourceKind === "rss" && it.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={it.imageUrl}
                      alt=""
                      style={{
                        width: 96,
                        height: 64,
                        objectFit: "cover",
                        borderRadius: 8,
                        border: "1px solid var(--faint)",
                        flexShrink: 0,
                      }}
                    />
                  )}
                </div>

                <div
                  style={{
                    marginTop: 6,
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    opacity: isRead ? 0.65 : 1,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      padding: "2px 8px",
                      borderRadius: 6,
                      background: "var(--surface-accent)",
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
                      opacity: isRead ? 0.65 : 1,
                    }}
                  >
                    {it.snippet}
                  </div>
                )}

                {!isRead && (
                  <div style={{ marginTop: 10 }}>
                    <button
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onMarkRead(it.id);
                      }}
                      style={{
                        fontSize: 12,
                        border: "1px solid var(--faint)",
                        background: "var(--surface)",
                        color: "var(--muted)",
                        borderRadius: 8,
                        padding: "4px 8px",
                        cursor: "pointer",
                      }}
                    >
                      Mark read
                    </button>
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
