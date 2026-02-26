"use client";

import { useState } from "react";

export function DeferredImage({ src, alt }: { src?: string; alt?: string }) {
  const [loaded, setLoaded] = useState(false);

  if (!src) return null;

  if (!loaded) {
    return (
      <button
        type="button"
        onClick={() => setLoaded(true)}
        style={{
          margin: "12px 0",
          padding: "6px 10px",
          borderRadius: 10,
          border: "1px solid var(--faint)",
          background: "#f1f5ff",
          color: "var(--accent-blue)",
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        Load image
      </button>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt ?? ""}
      loading="lazy"
      style={{
        maxWidth: "100%",
        height: "auto",
        borderRadius: 12,
        display: "block",
        margin: "12px 0",
      }}
    />
  );
}
