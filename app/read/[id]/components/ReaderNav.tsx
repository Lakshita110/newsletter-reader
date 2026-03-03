import Link from "next/link";

type NavItem = { id: string; subject: string };

export function ReaderNav({ nav }: { nav: { prev: NavItem | null; next: NavItem | null } | null }) {
  if (!nav?.prev && !nav?.next) return null;

  return (
    <div style={{ marginTop: 28, borderTop: "1px solid var(--faint)" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          paddingTop: 14,
          fontSize: 13,
          color: "var(--muted)",
        }}
      >
        {nav?.prev ? <Link href={`/read/${encodeURIComponent(nav.prev.id)}`}>Previous</Link> : <span />}
        {nav?.next ? <Link href={`/read/${encodeURIComponent(nav.next.id)}`}>Next</Link> : <span />}
      </div>
    </div>
  );
}
