import { signOut } from "next-auth/react";

type Props = {
  shownCount: number;
  todayStats: { readToday: number; inProgressToday: number; totalToday: number };
  userEmail?: string | null;
  q: string;
  onQueryChange: (value: string) => void;
  hasSelectedPublication: boolean;
  onClearPublication: () => void;
  olderUnreadCount: number;
  onCatchUpOlder: () => void;
};

export function InboxHeader({
  shownCount,
  todayStats,
  userEmail,
  q,
  onQueryChange,
  hasSelectedPublication,
  onClearPublication,
  olderUnreadCount,
  onCatchUpOlder,
}: Props) {
  return (
    <header style={{ marginBottom: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <h1 style={{ fontSize: 28, margin: 0, letterSpacing: -0.4 }}>Cluck&apos;s Feed</h1>
          <div style={{ color: "var(--muted)", fontSize: 14 }}>{shownCount} shown</div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            color: "var(--muted)",
            fontSize: 12,
          }}
        >
          <span>
            {todayStats.readToday} read, {todayStats.inProgressToday} in progress,{" "}
            {todayStats.totalToday} total today
          </span>
          {userEmail && <span style={{ whiteSpace: "nowrap" }}>{userEmail}</span>}
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            style={{
              border: "1px solid var(--faint)",
              background: "#fff",
              color: "var(--muted)",
              padding: "4px 8px",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          value={q}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search subject, sender, snippet..."
          style={{
            flex: "1 1 260px",
            background: "#fff",
            border: "1px solid var(--faint)",
            color: "var(--text)",
            padding: "10px 12px",
            borderRadius: 12,
            outline: "none",
          }}
        />

        {hasSelectedPublication && (
          <button
            onClick={onClearPublication}
            style={{
              background: "#fff",
              border: "1px solid var(--faint)",
              color: "var(--text)",
              padding: "10px 12px",
              borderRadius: 12,
              cursor: "pointer",
            }}
            title="Clear sender filter"
          >
            Clear sender
          </button>
        )}
        {olderUnreadCount > 0 && (
          <button
            onClick={onCatchUpOlder}
            style={{
              background: "#fff",
              border: "1px solid #bfdbfe",
              color: "#1d4ed8",
              padding: "10px 12px",
              borderRadius: 12,
              cursor: "pointer",
              fontWeight: 600,
            }}
            title="Mark yesterday and earlier items as read"
          >
            Catch up older ({olderUnreadCount})
          </button>
        )}
      </div>
    </header>
  );
}
