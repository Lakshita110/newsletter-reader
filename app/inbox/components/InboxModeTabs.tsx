import Link from "next/link";

export function InboxModeTabs({ mode }: { mode: "newsletters" | "rss" }) {
  const pill = (active: boolean): React.CSSProperties => ({
    border: "1px solid var(--faint)",
    borderRadius: 999,
    padding: "7px 12px",
    fontSize: 13,
    fontWeight: 600,
    background: active ? "#eef2ff" : "#fff",
    color: active ? "var(--accent-blue)" : "var(--muted)",
    textDecoration: "none",
  });

  return (
    <div style={{ marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Link href="/inbox/newsletters" style={pill(mode === "newsletters")}>
        Newsletters
      </Link>
      <Link href="/inbox/rss" style={pill(mode === "rss")}>
        RSS Feed
      </Link>
    </div>
  );
}

