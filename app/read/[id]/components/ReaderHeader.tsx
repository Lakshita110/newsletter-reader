import Link from "next/link";
import { formatDateTime, type ReadMessage } from "../lib/read-utils";

export function ReaderHeader({
  message,
  readingMinutes,
  view,
  onViewChange,
}: {
  message: ReadMessage;
  readingMinutes: number | null;
  view: "clean" | "original" | "text";
  onViewChange: (view: "clean" | "original" | "text") => void;
}) {
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

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => onViewChange("clean")} disabled={view === "clean"}>
            Clean
          </button>
          <button onClick={() => onViewChange("original")} disabled={view === "original"}>
            Original
          </button>
          <button onClick={() => onViewChange("text")} disabled={view === "text"}>
            Text
          </button>
        </div>
      </header>
    </>
  );
}
