import Link from "next/link";
import { faviconDomain } from "@/lib/lead-image";
import { formatDateTime, type ReadMessage } from "../lib/read-utils";

type View = "clean" | "original" | "text";

/**
 * Publication, date and reading time on one quiet line above a large title,
 * the way a magazine page opens. Actions (save, listen, done) live in the
 * reader toolbar only, so they aren't shown twice.
 */
export function ReaderHeader({
  message,
  readingMinutes,
  view,
  onViewChange,
  showViewControls,
  backHref,
}: {
  message: ReadMessage;
  readingMinutes: number | null;
  view: View;
  onViewChange: (view: View) => void;
  showViewControls: boolean;
  backHref: string;
}) {
  const sourceName = message.publicationName || nameOnly(message.from);
  const author = message.sourceKind === "rss" ? nameOnly(message.from) : null;
  const domain = faviconDomain(message.externalUrl, message.from);

  return (
    <header className="reader-header">
      {/* Phones have Back in the bottom toolbar; this link is for wide screens. */}
      <Link href={backHref} className="reader-back">
        ← {backHref.startsWith("/today?tab=saved") ? "Saved" : "Today"}
      </Link>
      <div className="reader-meta">
        {domain && (
          // eslint-disable-next-line @next/next/no-img-element -- tiny remote icon
          <img
            src={`https://icons.duckduckgo.com/ip3/${domain}.ico`}
            alt=""
            width={16}
            height={16}
            referrerPolicy="no-referrer"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        )}
        <span className="reader-meta-source">{sourceName}</span>
        <span>{formatDateTime(message.date)}</span>
        {readingMinutes !== null && <span>{readingMinutes} min read</span>}
      </div>
      <h1 className="reader-title">{message.subject || "(No subject)"}</h1>
      {author && author !== sourceName && <div className="reader-byline">By {author}</div>}

      {showViewControls && (
        <div className="reader-views" role="group" aria-label="Reading view">
          {(["clean", "original", "text"] as const).map((option) => (
            <button key={option} type="button" aria-pressed={view === option} onClick={() => onViewChange(option)}>
              {option === "clean" ? "Clean" : option === "original" ? "Original" : "Text"}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}

/** "Gergely Orosz <x@substack.com>" → "Gergely Orosz". */
function nameOnly(from: string): string {
  const name = from
    .replace(/<[^>]*>/g, "")
    .replace(/"/g, "")
    .trim();
  return name || from;
}
