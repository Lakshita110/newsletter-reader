"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const REPORT_EVERY_MS = 5000;

function currentScrollPct(): number {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (max <= 0) return 100;
  return Math.max(0, Math.min(100, (window.scrollY / max) * 100));
}

/**
 * Tracks how far through an article you are, reports it to /api/progress,
 * and offers to jump back to where you stopped last time.
 *
 * Reporting is throttled to every few seconds and flushed with sendBeacon on
 * pagehide, which is the only event iOS reliably fires when you swipe the
 * app away.
 */
export function useReadingProgress(id: string | undefined, ready: boolean) {
  const [pct, setPct] = useState(0);
  // Keyed by id so moving to the next article drops a stale offer without
  // resetting state inside an effect.
  const [resumeOffer, setResumeOffer] = useState<{ id: string; pct: number } | null>(null);
  const resumePct = resumeOffer && resumeOffer.id === id ? resumeOffer.pct : null;
  const setResumePct = useCallback(
    (pct: number | null) => setResumeOffer(pct === null || !id ? null : { id, pct }),
    [id]
  );
  const lastSent = useRef({ pct: -1, at: 0 });

  const send = useCallback(
    (useBeacon = false) => {
      if (!id) return;
      const nowPct = Math.round(currentScrollPct());
      if (Math.abs(nowPct - lastSent.current.pct) < 1) return;
      const secondsDelta = (Date.now() - lastSent.current.at) / 1000;
      lastSent.current = { pct: nowPct, at: Date.now() };
      const body = JSON.stringify({ messageId: id, scrollPct: nowPct, secondsDelta });
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon("/api/progress", new Blob([body], { type: "application/json" }));
        return;
      }
      fetch("/api/progress", { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch((error) =>
        console.warn("[reader] progress report failed", error)
      );
    },
    [id]
  );

  // Ask where we left off once content is on screen.
  useEffect(() => {
    if (!id || !ready) return;
    lastSent.current = { pct: -1, at: Date.now() };
    const controller = new AbortController();
    fetch(`/api/progress?id=${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const saved = Number(data?.scrollPct);
        if (!data?.completed && saved >= 5 && saved <= 95 && window.scrollY < 50) setResumePct(saved);
      })
      .catch(() => null);
    return () => controller.abort();
  }, [id, ready, setResumePct]);

  useEffect(() => {
    if (!id || !ready) return;
    const onScroll = () => {
      setPct(currentScrollPct());
      if (resumePct !== null && window.scrollY > 200) setResumePct(null);
    };
    const timer = setInterval(() => send(), REPORT_EVERY_MS);
    const onHide = () => send(true);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") send(true);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      send();
      clearInterval(timer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [id, ready, send, resumePct, setResumePct]);

  const resume = useCallback(() => {
    if (resumePct === null) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: (resumePct / 100) * max, behavior: "smooth" });
    setResumePct(null);
  }, [resumePct, setResumePct]);

  return { pct, resumePct, resume, dismissResume: () => setResumePct(null) };
}
