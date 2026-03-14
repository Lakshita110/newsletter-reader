import Link from "next/link";
import type { CSSProperties } from "react";
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

function categoryToneClass(value: string | null | undefined): string {
  const key = (value ?? "other").toLowerCase();
  return `category-tone-${key}`;
}

export function FeedList({
  grouped,
  ordered,
  selectedIndex,
  statusById,
  savedById,
  onOpen,
  onMarkRead,
  onOpenExternal,
  onToggleSaved,
  onDelete,
}: {
  grouped: GroupedInboxItems[];
  ordered: EnrichedInboxItem[];
  selectedIndex: number;
  statusById: Record<string, FeedReadStatus>;
  savedById?: Record<string, boolean>;
  onOpen: (id: string) => void;
  onMarkRead: (id: string) => void;
  onOpenExternal?: (url: string) => void;
  onToggleSaved?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const actionButtonStyle: CSSProperties = {
    fontSize: 12,
    border: "1px solid var(--faint)",
    background: "var(--surface)",
    color: "var(--muted)",
    borderRadius: 999,
    padding: "3px 8px",
    cursor: "pointer",
  };

  return (
    <section>
      {grouped.map((group) => (
        <div key={group.key} style={{ marginBottom: 18 }}>
          <div className={group.key === "today" ? "feed-group-label tone-today" : "feed-group-label"}>
            {group.label}
          </div>
          {group.items.map((it) => {
            const isSelected = ordered[selectedIndex]?.id === it.id;
            const status = statusById[it.id] ?? "unread";
            const isRead = status === "read";
            const hasThumb = it.sourceKind === "rss" && Boolean(it.imageUrl);
            const isSaved = savedById?.[it.id] === true;
            const dotToneClass = it.sourceKind === "rss" ? categoryToneClass(it.category) : "category-tone-news";

            return (
              <Link
                key={it.id}
                href={`/read/${it.id}`}
                onClick={() => onOpen(it.id)}
                data-feed-item-id={it.id}
                className="feed-item"
                style={{
                  display: "block",
                  padding: "24px 8px 14px",
                  borderBottom: "1px solid var(--faint)",
                  borderRadius: 0,
                  background: isSelected ? "var(--surface-accent-soft)" : "transparent",
                  opacity: isRead ? 0.86 : 1,
                }}
              >
                <div
                  className="feed-item-grid"
                  style={{
                    display: "grid",
                    gridTemplateColumns: hasThumb ? "minmax(0, 1fr) 96px" : "minmax(0, 1fr)",
                    columnGap: 12,
                    rowGap: 8,
                    alignItems: "start",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      className="feed-item-meta-row"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        marginBottom: 8,
                      }}
                    >
                      <span
                        className="feed-item-meta-text"
                        style={{
                          fontSize: 12,
                          color: "var(--muted)",
                          fontFamily: "var(--font-mono)",
                          letterSpacing: 0.4,
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span
                          className={dotToneClass}
                          style={{
                            display: "inline-block",
                            width: 7,
                            height: 7,
                            borderRadius: 999,
                            background: isRead ? "transparent" : "var(--tone-border, var(--accent-blue))",
                            border: isRead ? "1px solid var(--faint)" : "none",
                            marginRight: 8,
                          }}
                        />
                        {it.publicationName} - {formatDateTime(it.date)}
                      </span>

                      <div className="feed-item-actions" style={{ display: "flex", gap: 8 }}>
                        {it.externalUrl && (
                          <button
                            className="feed-item-action-btn"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              const externalUrl = it.externalUrl;
                              if (externalUrl && onOpenExternal) {
                                onOpenExternal(externalUrl);
                              } else if (externalUrl) {
                                window.open(externalUrl, "_blank", "noopener,noreferrer");
                              }
                            }}
                            style={actionButtonStyle}
                            title="Open full article"
                          >
                            Full article
                          </button>
                        )}
                        {onToggleSaved && (
                          <button
                            className="feed-item-action-btn feed-item-action-btn-saved"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              onToggleSaved(it.id);
                            }}
                            style={{
                              ...actionButtonStyle,
                              border: isSaved ? "1px solid color-mix(in oklab, var(--accent-blue) 55%, var(--faint))" : actionButtonStyle.border,
                              background: isSaved ? "var(--surface-accent-soft)" : actionButtonStyle.background,
                              color: isSaved ? "var(--accent-blue)" : actionButtonStyle.color,
                            }}
                            title={isSaved ? "Remove from saved" : "Save for later"}
                          >
                            {isSaved ? "Saved" : "Save for later"}
                          </button>
                        )}
                        {!isRead && (
                          <button
                            className="feed-item-action-btn"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              onMarkRead(it.id);
                            }}
                            style={actionButtonStyle}
                          >
                            Mark read
                          </button>
                        )}
                        {onDelete && it.sourceKind === "rss" && (
                          <button
                            className="feed-item-action-btn"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              onDelete(it.id);
                            }}
                            style={actionButtonStyle}
                            title="Delete item"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        fontSize: 17,
                        lineHeight: 1.3,
                        letterSpacing: -0.1,
                        fontWeight: 600,
                        fontFamily: "inherit",
                        color: "var(--text)",
                        minWidth: 0,
                      }}
                    >
                      {it.subject || "(No subject)"}
                    </div>
                  </div>

                  {it.snippet && (
                    <div
                      style={{
                        color: "var(--muted)",
                        fontSize: 15,
                        lineHeight: 1.7,
                        opacity: isRead ? 0.84 : 1,
                      }}
                    >
                      {summarizeSnippet(it.snippet)}
                    </div>
                  )}

                  {hasThumb && it.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="feed-item-thumb"
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
              </Link>
            );
          })}
        </div>
      ))}
    </section>
  );
}
