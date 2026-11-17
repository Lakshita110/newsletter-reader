"use client";

/**
 * Inline article image. Images used to sit behind a "Load image" tap, which made
 * photo-heavy newsletters read like a list of buttons; now they load lazily as
 * you scroll. no-referrer avoids hotlink blocks on some CDNs, and a broken image
 * is hidden instead of leaving an empty frame.
 */
export function DeferredImage({ src, alt }: { src?: string; alt?: string }) {
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote hosts, no optimizer config
    <img
      src={src}
      alt={alt ?? ""}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={(e) => (e.currentTarget.style.display = "none")}
      className="reader-inline-img"
    />
  );
}
