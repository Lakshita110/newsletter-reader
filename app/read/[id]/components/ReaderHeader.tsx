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
}: {
  message: ReadMessage;
  readingMinutes: number | null;
  view: "clean" | "original" | "text";
  onViewChange: (view: "clean" | "original" | "text") => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  isMarkedRead: boolean;
}) {
  const pillStyle = (active: boolean): React.CSSProperties => ({
    border: "1px solid var(--faint)",
    borderRadius: 999,
    padding: "6px 12px",
    cursor: "pointer",
    fontSize: 13,
    background: active ? "#eef2ff" : "#fff",
    color: active ? "var(--accent-blue)" : "var(--muted)",
  });

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

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => onViewChange("clean")}
            disabled={view === "clean"}
            style={pillStyle(view === "clean")}
          >
            Clean
          </button>
          <button
            onClick={() => onViewChange("original")}
            disabled={view === "original"}
            style={pillStyle(view === "original")}
          >
            Original
          </button>
          <button
            onClick={() => onViewChange("text")}
            disabled={view === "text"}
            style={pillStyle(view === "text")}
          >
            Text
          </button>
        </div>

        <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {isMarkedRead && (
            <button
              onClick={onMarkUnread}
              style={{
                border: "1px solid var(--faint)",
                borderRadius: 999,
                padding: "7px 12px",
                cursor: "pointer",
                fontSize: 13,
                background: "#fff",
                color: "var(--muted)",
                fontWeight: 600,
              }}
            >
              Mark as unread
            </button>
          )}
          <button
            onClick={onMarkRead}
            disabled={isMarkedRead}
            style={{
              border: "1px solid #86efac",
              borderRadius: 999,
              padding: "7px 12px",
              cursor: "pointer",
              fontSize: 13,
              background: isMarkedRead ? "#f0fdf4" : "#dcfce7",
              color: isMarkedRead ? "#166534" : "#14532d",
              fontWeight: 600,
            }}
          >
            {isMarkedRead ? "Read" : "Mark as read"}
          </button>
        </div>
      </header>
    </>
  );
}
