"use client";

import { useState } from "react";
import type { HighlightRow } from "../lib/useHighlights";

/**
 * Paint style for the CSS Custom Highlight API. Rendered as an inline <style>
 * because the CSS bundler rejects `::highlight()` in globals.css.
 */
export function HighlightPaintStyle() {
  return <style>{`::highlight(reader-highlight){background-color:rgba(250,204,21,.45);color:inherit}`}</style>;
}

/** Floating bar that appears when text is selected in the article. */
export function SelectionBar({ onHighlight }: { onHighlight: (note?: string) => void }) {
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");

  if (noting) {
    return (
      <div className="hl-sheet" role="dialog" aria-label="Add a note">
        <textarea
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Your note…"
          rows={3}
        />
        <div className="hl-sheet-actions">
          <button type="button" onClick={() => setNoting(false)}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => onHighlight(note)}>
            Save highlight
          </button>
        </div>
      </div>
    );
  }
  return (
    // onPointerDown preventDefault keeps the text selection alive on iOS.
    <div className="hl-bar" onPointerDown={(e) => e.preventDefault()}>
      <button type="button" onClick={() => onHighlight()}>
        Highlight
      </button>
      <button type="button" onClick={() => setNoting(true)}>
        + Note
      </button>
    </div>
  );
}

/** The article's highlights, listed after the text, with note editing. */
export function HighlightList({
  highlights,
  onUpdateNote,
  onRemove,
}: {
  highlights: HighlightRow[];
  onUpdateNote: (id: string, note: string) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  if (highlights.length === 0) return null;
  return (
    <section className="hl-list" aria-label="Your highlights">
      <h2>Your highlights ({highlights.length})</h2>
      {highlights.map((h) => (
        <div key={h.id} className="hl-item">
          <blockquote>{h.quote}</blockquote>
          {editing === h.id ? (
            <div className="hl-sheet-inline">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} autoFocus />
              <div className="hl-sheet-actions">
                <button type="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    onUpdateNote(h.id, draft);
                    setEditing(null);
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <>
              {h.note && <p className="hl-note">{h.note}</p>}
              <div className="hl-item-actions">
                <button
                  type="button"
                  onClick={() => {
                    setDraft(h.note ?? "");
                    setEditing(h.id);
                  }}
                >
                  {h.note ? "Edit note" : "Add note"}
                </button>
                <button type="button" onClick={() => onRemove(h.id)}>
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </section>
  );
}
