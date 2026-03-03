import Link from "next/link";
import { formatDateTime } from "../lib/date";
import type { EnrichedInboxItem, FeedReadStatus, GroupedInboxItems } from "../types";

function summarizeSnippet(snippet: string): string {
  const normalized = snippet.replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const firstSentence = normalized.split(/(?<=[.!?])\s+/)[0] ?? normalized;
  const maxChars = 170;
  if (firstSentence.length <= maxChars) return firstSentence;
  return `${firstSentence.slice(0, maxChars).trimEnd()}...`;
}

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
            const hasThumb = it.sourceKind === "rss" && Boolean(it.imageUrl);

            return (
              <Link
                key={it.id}
                href={`/read/${it.id}`}
                onClick={() => onOpen(it.id)}
                data-feed-item-id={it.id}
                className="feed-item"
                style={{
                  display: "block",
                  padding: "14px 10px",
                  borderBottom: "1px solid var(--faint)",
                  borderRadius: 10,
                  background: isSelected ? "var(--surface-muted)" : "transparent",
                  opacity: isRead ? 0.86 : 1,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: hasThumb ? "minmax(0, 1fr) 96px" : "minmax(0, 1fr)",
                    columnGap: 12,
                    rowGap: 8,
                    alignItems: "start",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
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
                        fontWeight: isRead ? 450 : 550,
                        letterSpacing: -0.2,
                        opacity: 1,
                        minWidth: 0,
                      }}
                    >
                      {it.subject || "(No subject)"}
                    </div>
                  </div>

                  <div
                    style={{
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
                        background: isRead ? "var(--surface)" : "var(--surface-accent)",
                        border: isRead ? "1px solid var(--faint)" : "1px solid transparent",
                        color: isRead ? "var(--muted)" : "var(--accent-blue)",
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
                        color: "var(--muted)",
                        fontSize: 14,
                        lineHeight: 1.45,
                        opacity: isRead ? 0.84 : 1,
                      }}
                    >
                      {summarizeSnippet(it.snippet)}
                    </div>
                  )}

                  {!isRead && (
                    <div>
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

                  {hasThumb && it.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={it.imageUrl}
                      alt=""
                      style={{
                        gridColumn: 2,
                        gridRow: "1 / span 4",
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
              </Link>
            );
          })}
        </div>
      ))}
    </section>
  );
}
