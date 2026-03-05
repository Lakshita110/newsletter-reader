import { useEffect, useRef, useState } from "react";
import { formatDayPillLabel } from "../lib/date";

export type InboxViewMode = "recommended" | "today" | "unread" | "saved" | "all";

const defaultModeLabel: Record<InboxViewMode, string> = {
  recommended: "Recommended",
  today: "Today",
  unread: "Unread",
  saved: "Saved",
  all: "All",
};

type Option = { key: string; label: string };

export function InboxFilters({
  viewMode,
  onViewModeChange,
  selectedPub,
  selectedCategory,
  selectedDay,
  publicationOptions,
  categoryOptions,
  dayOptions,
  onPublicationChange,
  onCategoryChange,
  onDayChange,
  rightAction,
  modeOrder,
  modeLabelOverrides,
}: {
  viewMode: InboxViewMode;
  onViewModeChange: (mode: InboxViewMode) => void;
  selectedPub: string | null;
  selectedCategory: string | null;
  selectedDay: string | null;
  publicationOptions: Option[];
  categoryOptions?: Option[];
  dayOptions: Option[];
  onPublicationChange: (key: string | null) => void;
  onCategoryChange?: (key: string | null) => void;
  onDayChange: (key: string | null) => void;
  rightAction?: React.ReactNode;
  modeOrder?: InboxViewMode[];
  modeLabelOverrides?: Partial<Record<InboxViewMode, string>>;
}) {
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const sourceMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showSourceMenu) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && sourceMenuRef.current?.contains(target)) return;
      setShowSourceMenu(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowSourceMenu(false);
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
  
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showSourceMenu]);

  const modeList = modeOrder ?? ["today", "unread", "saved", "all"];
  const modeLabel = { ...defaultModeLabel, ...(modeLabelOverrides ?? {}) };

  const tagStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: "1px solid var(--faint)",
    borderRadius: 999,
    padding: "3px 8px",
    color: "var(--muted)",
    fontSize: 12,
    background: "var(--surface)",
  };

  const selectedPubLabel =
    selectedPub == null
      ? null
      : publicationOptions.find((it) => it.key === selectedPub)?.label ?? "Source";
  const selectedCategoryLabel =
    selectedCategory == null
      ? null
      : categoryOptions?.find((it) => it.key === selectedCategory)?.label ?? "Category";
  const selectedDayLabel =
    selectedDay == null ? null : dayOptions.find((it) => it.key === selectedDay)?.label ?? "Date";

  return (
    <section style={{ marginBottom: 14, borderBottom: "1px solid var(--faint)", paddingBottom: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {modeList.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onViewModeChange(mode)}
              style={{
                border: "1px solid transparent",
                background: "transparent",
                color: viewMode === mode ? "var(--accent-blue)" : "var(--muted)",
                fontSize: 14,
                padding: "4px 8px",
                borderRadius: 999,
                cursor: "pointer",
                fontWeight: viewMode === mode ? 600 : 500,
              }}
            >
              {modeLabel[mode]}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {rightAction}
          <div ref={sourceMenuRef} style={{ position: "relative" }}>
            <button
              type="button"
              className="filter-select"
              aria-label="Filter by source"
              onClick={() => setShowSourceMenu((prev) => !prev)}
              style={{ minWidth: 190, justifyContent: "space-between" }}
            >
              <span>{selectedPubLabel ? `Source: ${selectedPubLabel}` : "Source"}</span>
              <span style={{ marginLeft: 10 }}>{showSourceMenu ? "▴" : "▾"}</span>
            </button>
            {showSourceMenu && (
              <div className="filter-menu">
                <button
                  type="button"
                  className="filter-menu-item"
                  onClick={() => {
                    onPublicationChange(null);
                    setShowSourceMenu(false);
                  }}
                >
                  All sources
                </button>
                {publicationOptions.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={selectedPub === item.key ? "filter-menu-item active" : "filter-menu-item"}
                    onClick={() => {
                      onPublicationChange(item.key);
                      setShowSourceMenu(false);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {categoryOptions && onCategoryChange && (
            <select
              value={selectedCategory ?? ""}
              onChange={(event) => onCategoryChange(event.target.value || null)}
              className="filter-select"
              aria-label="Filter by category"
            >
              <option value="">Category</option>
              {categoryOptions.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          )}
          <select
            value={selectedDay ?? ""}
            onChange={(event) => onDayChange(event.target.value || null)}
            className="filter-select"
            aria-label="Filter by date"
          >
            <option value="">Date</option>
            {dayOptions.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {(selectedPubLabel || selectedCategoryLabel || selectedDayLabel) && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {selectedPubLabel && (
            <button type="button" onClick={() => onPublicationChange(null)} style={tagStyle}>
              Source: {selectedPubLabel} ×
            </button>
          )}
          {selectedCategoryLabel && onCategoryChange && (
            <button type="button" onClick={() => onCategoryChange(null)} style={tagStyle}>
              Category: {selectedCategoryLabel} ×
            </button>
          )}
          {selectedDayLabel && (
            <button type="button" onClick={() => onDayChange(null)} style={tagStyle}>
              Date: {selectedDayLabel} ×
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function toDayOptions(days: { key: string }[]): Option[] {
  return days.map((d) => ({ key: d.key, label: formatDayPillLabel(d.key) }));
}

