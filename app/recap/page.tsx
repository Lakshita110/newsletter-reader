"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppNav } from "@/app/components/AppNav";
import type { Recap } from "@/lib/recap";

const dayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * A once-a-week look back: what she read, what she highlighted, and the
 * newsletters from the week she skipped that are worth a second look.
 */
export default function RecapPage() {
  const [recap, setRecap] = useState<Recap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/recap", { signal: controller.signal, cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`recap ${res.status}`);
        return res.json() as Promise<Recap>;
      })
      .then(setRecap)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error("[recap] load failed", err);
        setError("Couldn't load your week. Try again in a moment.");
      });
    return () => controller.abort();
  }, []);

  const range = recap ? `${dayFormat.format(new Date(recap.since))} – ${dayFormat.format(new Date())}` : "";

  return (
    <main className="today-shell">
      <header className="today-header">
        <div>
          <h1 className="today-title">Your week</h1>
          <p className="today-subtitle">{error ?? (recap ? range : "Loading…")}</p>
        </div>
      </header>

      {recap && (
        <>
          <section className="recap-stats" aria-label="This week in numbers">
            <div>
              <strong>{recap.read.length}</strong>
              <span>read</span>
            </div>
            <div>
              <strong>{recap.minutesRead}</strong>
              <span>min reading</span>
            </div>
            <div>
              <strong>{recap.highlights.length}</strong>
              <span>highlights</span>
            </div>
          </section>
          {recap.topPublications.length > 0 && (
            <p className="recap-note">
              Most read: {recap.topPublications.map((p) => `${p.name} (${p.count})`).join(", ")}
            </p>
          )}
          {recap.clearedCount > 0 && (
            <p className="recap-note">
              Plus {recap.clearedCount} cleared without reading here (swiped away, or opened on the publisher&rsquo;s
              site).
            </p>
          )}

          <section className="today-section">
            <h2 className="today-section-title">
              Worth a second look <span>{recap.secondLook.length}</span>
            </h2>
            {recap.secondLook.length === 0 ? (
              <p className="recap-note">You read every newsletter this week.</p>
            ) : (
              <ul className="today-list">
                {recap.secondLook.map((item) => (
                  <li key={item.id}>
                    <Link href={`/read/${encodeURIComponent(item.id)}`} className="today-row">
                      <div className="today-row-meta">
                        <span className="today-row-pub">{item.publicationName}</span>
                        <span>{dayFormat.format(new Date(item.date))}</span>
                        {item.readMinutes && <span>{item.readMinutes} min</span>}
                      </div>
                      <div className="today-row-title">{item.subject || "(No subject)"}</div>
                      {item.snippet && <div className="today-row-snippet">{item.snippet}</div>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {recap.highlights.length > 0 && (
            <section className="today-section">
              <h2 className="today-section-title">
                Highlights <span>{recap.highlights.length}</span>
              </h2>
              {recap.highlights.map((h) => (
                <Link key={h.id} href={`/read/${encodeURIComponent(h.itemId)}`} className="hl-item recap-hl">
                  <blockquote>{h.quote}</blockquote>
                  <p className="hl-note">{h.publicationName ?? h.itemTitle}</p>
                </Link>
              ))}
              <Link href="/highlights" className="recap-more">
                All highlights →
              </Link>
            </section>
          )}

          {recap.read.length > 0 && (
            <section className="today-section">
              <h2 className="today-section-title">
                What you read <span>{recap.read.length}</span>
              </h2>
              <ul className="today-list">
                {recap.read.map((item) => (
                  <li key={item.id}>
                    <Link href={`/read/${encodeURIComponent(item.id)}`} className="today-row">
                      <div className="today-row-meta">
                        <span className="today-row-pub">{item.publicationName}</span>
                        <span>{item.minutes} min</span>
                      </div>
                      <div className="today-row-title">{item.title}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <AppNav active="highlights" />
    </main>
  );
}
