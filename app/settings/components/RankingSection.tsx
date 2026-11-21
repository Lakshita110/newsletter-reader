"use client";

import { useEffect, useState } from "react";

type Settings = {
  recommendationCap: number;
  recommendationPrompt: string;
  limits: { minCap: number; maxCap: number; maxPromptChars: number };
};

/**
 * What the ranker should favor, in her words, plus how many stories it picks
 * a day. The prompt goes straight into the ranking prompt (lib/rss-ai-ranker),
 * so it is the main way to steer Today. Changes apply on the next ranking:
 * tap Re-rank in Today to see them right away.
 */
export default function RankingSection() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [prompt, setPrompt] = useState("");
  const [cap, setCap] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/rss/recommendations-settings", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`settings ${res.status}`))))
      .then((data: Settings) => {
        setSettings(data);
        setPrompt(data.recommendationPrompt);
        setCap(data.recommendationCap);
      })
      .catch((err) => {
        console.error("[settings] load ranking settings failed", err);
        setStatus("Couldn't load ranking settings.");
      });
  }, []);

  const save = async () => {
    setStatus("Saving…");
    const res = await fetch("/api/rss/recommendations-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recommendationPrompt: prompt, recommendationCap: cap }),
    });
    setStatus(res.ok ? "Saved. Re-rank in Today to apply it now." : "Couldn't save.");
  };

  if (!settings) return status ? <p className="settings-note">{status}</p> : null;
  const dirty = prompt !== settings.recommendationPrompt || cap !== settings.recommendationCap;

  return (
    <section style={{ marginBottom: 18, borderBottom: "1px solid var(--faint)", paddingBottom: 16 }}>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>What to pick for you</div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value.slice(0, settings.limits.maxPromptChars))}
        placeholder="e.g. Favor AI, startups and engineering deep dives. Skip sports and celebrity news."
        className="settings-input"
        rows={4}
        style={{ width: "100%", height: "auto", padding: 10, resize: "vertical", lineHeight: 1.5 }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
        <label style={{ fontSize: 13, color: "var(--muted)" }}>
          Stories per day{" "}
          <input
            type="number"
            min={settings.limits.minCap}
            max={settings.limits.maxCap}
            value={cap}
            onChange={(e) => setCap(Number(e.target.value) || settings.limits.minCap)}
            className="settings-input"
            style={{ width: 70, marginLeft: 6 }}
          />
        </label>
        <button type="button" className="filter-action-btn" onClick={save} disabled={!dirty}>
          Save
        </button>
        {status && <span style={{ fontSize: 13, color: "var(--muted)" }}>{status}</span>}
      </div>
    </section>
  );
}
