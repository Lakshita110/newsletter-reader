"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { splitForSpeech } from "./speech-chunks";

const noopSubscribe = () => () => {};

/** Speak chunks[index..] one after another; recursion lives outside React. */
function speakChunks(
  chunks: string[],
  index: number,
  cb: { isCurrent: () => boolean; onChunkDone: (next: number) => void; onFinished: (completed: boolean) => void }
) {
  if (index >= chunks.length) {
    cb.onFinished(true);
    return;
  }
  const utterance = new SpeechSynthesisUtterance(chunks[index]);
  utterance.rate = 1.05;
  utterance.onend = () => {
    // Some browsers fire onend (not onerror) when cancel() pauses us; a stale
    // run must not carry on speaking the next chunk.
    if (!cb.isCurrent()) return;
    cb.onChunkDone(index + 1);
    speakChunks(chunks, index + 1, cb);
  };
  utterance.onerror = (event) => {
    if (!cb.isCurrent()) return;
    // "interrupted"/"canceled" are our own Pause; anything else is a real failure.
    if (event.error !== "interrupted" && event.error !== "canceled") {
      console.error("[listen] speech failed", event.error);
    }
    cb.onFinished(false);
  };
  window.speechSynthesis.speak(utterance);
}

/**
 * Read the article aloud with the browser's built-in voice: free, offline on
 * iPhone, and no audio files to generate or store. Speaks one chunk at a time
 * (see splitForSpeech) and remembers the position so Pause/Listen resumes.
 */
export function useReadAloud(articleRef: RefObject<HTMLElement | null>, itemId: string) {
  const [speaking, setSpeaking] = useState(false);
  const position = useRef(0);
  const chunks = useRef<string[]>([]);
  const run = useRef(0);
  // Server render says "unsupported" and the client corrects it after
  // hydration, so the button never causes a hydration mismatch.
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => "speechSynthesis" in window,
    () => false
  );

  const stop = useCallback(() => {
    if (!supported) return;
    run.current += 1;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  // A new article starts from the top, and leaving the page stops the voice.
  useEffect(() => {
    position.current = 0;
    chunks.current = [];
    return () => {
      run.current += 1;
      setSpeaking(false);
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [itemId]);

  const toggle = useCallback(() => {
    if (!supported) return;
    if (speaking) {
      stop();
      return;
    }
    if (chunks.current.length === 0) {
      chunks.current = splitForSpeech(articleRef.current?.innerText ?? "");
    }
    window.speechSynthesis.cancel();
    setSpeaking(true);
    const thisRun = ++run.current;
    speakChunks(chunks.current, position.current, {
      isCurrent: () => run.current === thisRun,
      onChunkDone: (next) => (position.current = next),
      onFinished: (completed) => {
        if (completed) position.current = 0;
        setSpeaking(false);
      },
    });
  }, [articleRef, speaking, stop, supported]);

  return { supported, speaking, toggle };
}
