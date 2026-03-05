"use client";

export function HighlightPopover({
  x,
  y,
  saving,
  onSave,
}: {
  x: number;
  y: number;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <button
      // preventDefault stops the click from clearing the selection before onSave fires
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSave}
      disabled={saving}
      style={{
        position: "fixed",
        left: x,
        top: y - 44,
        transform: "translateX(-50%)",
        background: "#111",
        color: "#fff",
        border: "none",
        borderRadius: 6,
        padding: "6px 14px",
        fontSize: 13,
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontWeight: 500,
        cursor: saving ? "default" : "pointer",
        zIndex: 9999,
        boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
        opacity: saving ? 0.6 : 1,
        pointerEvents: saving ? "none" : "auto",
        whiteSpace: "nowrap",
      }}
    >
      {saving ? "Saving…" : "Highlight"}
    </button>
  );
}
