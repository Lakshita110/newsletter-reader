import { formatDayLabel, formatDayPillLabel } from "../lib/date";

const pillStyle = (active: boolean): React.CSSProperties => ({
  cursor: "pointer",
  borderRadius: 999,
  padding: "6px 10px",
  fontSize: 13,
  border: "1px solid var(--faint)",
  background: active ? "#eef2ff" : "#fff",
  color: active ? "var(--accent-blue)" : "var(--muted)",
});

export function PublicationPills({
  selectedPub,
  publications,
  onSelect,
}: {
  selectedPub: string | null;
  publications: { key: string; name: string; count: number }[];
  onSelect: (key: string | null) => void;
}) {
  return (
    <section style={{ marginBottom: 18 }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          padding: 12,
          background: "#fff",
          border: "1px solid var(--faint)",
          borderRadius: 16,
        }}
      >
        <button onClick={() => onSelect(null)} style={pillStyle(selectedPub === null)}>
          All
        </button>

        {publications.slice(0, 16).map((p) => (
          <button
            key={p.key}
            onClick={() => onSelect(p.key)}
            style={pillStyle(selectedPub === p.key)}
            title={`${p.count} in last 30d`}
          >
            {p.name}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 13 }}>
        Tip: start with the top 10-16 senders; later add a More button.
      </div>
    </section>
  );
}

export function DayPills({
  selectedDay,
  days,
  onSelect,
}: {
  selectedDay: string | null;
  days: { key: string; count: number }[];
  onSelect: (key: string | null) => void;
}) {
  return (
    <section style={{ marginBottom: 18 }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          padding: 12,
          background: "#fff",
          border: "1px solid var(--faint)",
          borderRadius: 16,
        }}
      >
        <button onClick={() => onSelect(null)} style={pillStyle(selectedDay === null)}>
          All days
        </button>

        {days.map((d) => (
          <button
            key={d.key}
            onClick={() => onSelect(d.key)}
            style={pillStyle(selectedDay === d.key)}
            title={`${d.count} on ${formatDayLabel(d.key)}`}
          >
            {formatDayPillLabel(d.key)}
          </button>
        ))}
      </div>
    </section>
  );
}

