"use client";

import { Fragment, useState } from "react";

/** Render the model's tiny Markdown subset (bullets + **bold**) without innerHTML. */
function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>
  );
}

function SummaryBody({ summary }: { summary: string }) {
  const lines = summary.split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => /^[-*•]\s+/.test(l)).map((l) => l.replace(/^[-*•]\s+/, ""));
  const rest = lines.filter((l) => !/^[-*•]\s+/.test(l));
  return (
    <>
      {bullets.length > 0 && (
        <ul>
          {bullets.map((b, i) => (
            <li key={i}>{renderInline(b)}</li>
          ))}
        </ul>
      )}
      {rest.map((l, i) => (
        <p key={i}>{renderInline(l)}</p>
      ))}
    </>
  );
}

/**
 * On-demand "what's in this" for long pieces. Nothing is sent to the model
 * until tapped; the result is cached server-side per article.
 */
export function SummaryCard({ itemId, minutes }: { itemId: string; minutes: number | null }) {
  const [state, setState] = useState<{ kind: "idle" | "loading" } | { kind: "done"; summary: string } | { kind: "error"; message: string }>({
    kind: "idle",
  });
  if (minutes !== null && minutes < 4) return null;

  const run = async () => {
    setState({ kind: "loading" });
    const res = await fetch("/api/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setState({ kind: "done", summary: data.summary });
    else setState({ kind: "error", message: data?.error || `Couldn't summarize (${res.status})` });
  };

  if (state.kind === "done") {
    return (
      <aside className="summary-card" aria-label="Summary">
        <div className="summary-card-label">Summary</div>
        <SummaryBody summary={state.summary} />
      </aside>
    );
  }
  return (
    <div className="summary-cta">
      <button type="button" onClick={run} disabled={state.kind === "loading"}>
        {state.kind === "loading" ? "Summarizing…" : "✦ Summarize"}
      </button>
      {state.kind === "error" && <span className="summary-error">{state.message}</span>}
    </div>
  );
}
