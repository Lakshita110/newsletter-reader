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
        className="reader-inline-action"
        style={{
          margin: "12px 0",
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
