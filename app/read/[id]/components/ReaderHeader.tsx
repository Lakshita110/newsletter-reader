import Link from "next/link";
import { formatDateTime, type ReadMessage } from "../lib/read-utils";

export function ReaderHeader({
  message,
  readingMinutes,
  view,
  onViewChange,
  onMarkRead,
  onMarkUnread,
  isMarkedRead,
  showViewControls,
  externalUrl,
}: {
  message: ReadMessage;
  readingMinutes: number | null;
  view: "clean" | "original" | "text";
  onViewChange: (view: "clean" | "original" | "text") => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  isMarkedRead: boolean;
  showViewControls: boolean;
  externalUrl?: string | null;
}) {
  const basePill: React.CSSProperties = {
    borderRadius: 999,
    padding: "0 14px",
    fontSize: 14,
    lineHeight: 1,
    fontWeight: 600,
    height: 38,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    whiteSpace: "nowrap",
    boxSizing: "border-box",
    appearance: "none",
    WebkitAppearance: "none",
    textDecoration: "none",
  };

  const modePillStyle = (active: boolean): React.CSSProperties => ({
    ...basePill,
    border: "1px solid var(--faint)",
    background: active ? "#eef2ff" : "#fff",
    color: active ? "var(--accent-blue)" : "var(--muted)",
  });

  const actionPillStyle = (
    kind: "primary" | "neutral" | "link",
    active = false
  ): React.CSSProperties => {
    if (kind === "primary") {
      return {
        ...basePill,
        border: "1px solid #86efac",
        background: active ? "#f0fdf4" : "#dcfce7",
        color: active ? "#166534" : "#14532d",
      };
    }
    if (kind === "link") {
      return {
        ...basePill,
        border: "1px solid #dbeafe",
        background: "#f8fbff",
        color: "#1d4ed8",
      };
    }
    return {
      ...basePill,
      border: "1px solid var(--faint)",
      background: "#fff",
      color: "var(--muted)",
    };
  };

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <Link
          href="/inbox"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: "var(--muted)",
          }}
        >
          Back to inbox
        </Link>
      </div>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
          {message.subject || "(No subject)"}
        </h1>
        <div style={{ opacity: 0.8, marginBottom: 6 }}>{message.from}</div>
        <div style={{ opacity: 0.6, marginBottom: 12 }}>{formatDateTime(message.date)}</div>
        {readingMinutes !== null && (
          <div style={{ opacity: 0.6, marginBottom: 12 }}>{readingMinutes} min read</div>
        )}

        <div
          style={{
            marginTop: 10,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          {showViewControls ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() => onViewChange("clean")}
                disabled={view === "clean"}
                style={modePillStyle(view === "clean")}
              >
                Clean
              </button>
              <button
                onClick={() => onViewChange("original")}
                disabled={view === "original"}
                style={modePillStyle(view === "original")}
              >
                Original
              </button>
              <button
                onClick={() => onViewChange("text")}
                disabled={view === "text"}
                style={modePillStyle(view === "text")}
              >
                Text
              </button>
            </div>
          ) : (
            <div />
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {externalUrl && (
              <a
                href={externalUrl}
                target="_blank"
                rel="noreferrer"
                style={actionPillStyle("link")}
              >
                Open full article
              </a>
            )}
            {isMarkedRead && (
              <button onClick={onMarkUnread} style={actionPillStyle("neutral")}>
                Mark as unread
              </button>
            )}
            <button
              onClick={onMarkRead}
              disabled={isMarkedRead}
              style={actionPillStyle("primary", isMarkedRead)}
            >
              {isMarkedRead ? "Read" : "Mark as read"}
            </button>
          </div>
        </div>
      </header>
    </>
  );
}
