"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { highlightsToMarkdown, type ExportHighlight } from "@/lib/highlight-helpers";

type Row = ExportHighlight & { id: string };
type Range = "week" | "month" | "all";

function since(range: Range): string | null {
  if (range === "all") return null;
  const d = new Date();
  d.setDate(d.getDate() - (range === "week" ? 7 : 30));
  return d.toISOString();
}

/**
 * Everything you've highlighted, grouped by article, with a one-tap export
 * to Markdown for the weekly synthesis note (Notion turns pasted Markdown
 * into proper headings and quotes).
 */
export default function HighlightsPage() {
  const [range, setRange] = useState<Range>("week");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const s = since(range);
    const controller = new AbortController();
    fetch(`/api/highlights${s ? `?since=${encodeURIComponent(s)}` : ""}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : []))
      .then(setRows)
      .catch(() => null);
    return () => controller.abort();
  }, [range]);

  const heading =
    range === "week" ? "Highlights: past week" : range === "month" ? "Highlights: past 30 days" : "All highlights";
  const markdown = useMemo(() => (rows && rows.length ? highlightsToMarkdown(rows, heading) : ""), [rows, heading]);
  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows ?? []) map.set(r.itemId, [...(map.get(r.itemId) ?? []), r]);
    return [...map.values()];
  }, [rows]);

  const copy = async () => {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `highlights-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="today-shell">
      <header className="today-header">
        <div>
          <h1 className="today-title">Highlights</h1>
          <p className="today-subtitle">
            {rows === null
              ? "Loading…"
              : `${rows.length} from ${groups.length} article${groups.length === 1 ? "" : "s"}`}
          </p>
        </div>
      </header>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {(["week", "month", "all"] as Range[]).map((r) => (
          <button
            key={r}
            type="button"
            className={`filter-action-btn${range === r ? " active" : ""}`}
            onClick={() => setRange(r)}
            aria-pressed={range === r}
          >
            {r === "week" ? "This week" : r === "month" ? "30 days" : "All"}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button type="button" className="filter-action-btn" onClick={copy} disabled={!markdown}>
          {copied ? "Copied" : "Copy as Markdown"}
        </button>
        <button type="button" className="filter-action-btn" onClick={download} disabled={!markdown}>
          Download .md
        </button>
      </div>

      {rows !== null && rows.length === 0 && (
        <div className="today-empty">Select text while reading and tap Highlight. It all collects here.</div>
      )}

      {groups.map((group) => {
        const first = group[0];
        return (
          <section key={first.itemId} className="today-section">
            <Link href={`/read/${encodeURIComponent(first.itemId)}`} className="today-row" style={{ paddingBottom: 6 }}>
              <div className="today-row-meta">
                <span className="today-row-pub">{first.publicationName}</span>
              </div>
              <div className="today-row-title">{first.itemTitle}</div>
            </Link>
            {[...group].reverse().map((h) => (
              <div key={h.id} className="hl-item">
                <blockquote>{h.quote}</blockquote>
                {h.note && <p className="hl-note">{h.note}</p>}
              </div>
            ))}
          </section>
        );
      })}

      <nav className="today-tabbar" aria-label="Sections">
        <Link href="/today">Today</Link>
        <Link href="/today?tab=saved">Saved</Link>
        <Link href="/highlights" className="active">
          Highlights
        </Link>
        <Link href="/settings">Settings</Link>
      </nav>
    </main>
  );
}
