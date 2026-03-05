import Link from "next/link";

export function ShowEarlierButton({
  hiddenCount,
  showingAll,
  onToggle,
}: {
  hiddenCount: number;
  showingAll: boolean;
  onToggle: () => void;
}) {
  if (hiddenCount <= 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        onClick={onToggle}
        style={{
          border: "1px solid var(--faint)",
          borderRadius: 999,
          background: "var(--surface)",
          color: "var(--muted)",
          padding: "6px 10px",
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        {showingAll ? "Show fewer earlier" : `Show ${hiddenCount} more earlier`}
      </button>
    </div>
  );
}

export function CatchUpOlderButton({ count, onClick }: { count: number; onClick: () => void }) {
  if (count <= 0) return null;
  return (
    <div style={{ margin: "18px 0 0" }}>
      <button onClick={onClick} className="btn-pill btn-neutral">
        Catch up older ({count})
      </button>
    </div>
  );
}

export function OverflowSources({
  entries,
}: {
  entries: { sourceId: string; sourceName: string; count: number }[];
}) {
  if (entries.length === 0) return null;

  return (
    <div
      style={{
        margin: "4px 0 16px",
        padding: "10px 12px",
        border: "1px solid var(--faint)",
        borderRadius: 10,
        background: "var(--surface)",
        color: "var(--muted)",
        fontSize: 13,
      }}
    >
      <div style={{ marginBottom: 6 }}>More available by source:</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {entries.slice(0, 8).map((x) => (
          <Link
            key={x.sourceId}
            href={`/source/${x.sourceId}`}
            style={{
              border: "1px solid var(--faint)",
              borderRadius: 999,
              padding: "4px 8px",
              color: "var(--link)",
              background: "var(--surface-accent-soft)",
            }}
          >
            {x.count} more from {x.sourceName}
          </Link>
        ))}
      </div>
    </div>
  );
}
