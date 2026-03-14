"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  RSS_RECOMMENDATION_CAP_DEFAULT,
  RSS_RECOMMENDATION_CAP_MAX,
  RSS_RECOMMENDATION_CAP_MIN,
  RSS_RECOMMENDATION_PROMPT_MAX_CHARS,
} from "@/lib/rss-recommendation-settings";

export default function RecommendationSettingsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [recommendationCap, setRecommendationCap] = useState<number>(RSS_RECOMMENDATION_CAP_DEFAULT);
  const [recommendationPrompt, setRecommendationPrompt] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; kind: "success" | "error" } | null>(null);

  useEffect(() => {
    if (session === null) router.replace("/sign-in");
  }, [session, router]);

  useEffect(() => {
    if (!session?.user?.email) return;
    const load = async () => {
      const res = await fetch("/api/rss/recommendations-settings", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (!data) return;
      setRecommendationCap(Number(data.recommendationCap) || RSS_RECOMMENDATION_CAP_DEFAULT);
      setRecommendationPrompt(typeof data.recommendationPrompt === "string" ? data.recommendationPrompt : "");
    };
    load().catch(() => null);
  }, [session?.user?.email]);

  if (!session) {
    return (
      <main style={{ maxWidth: 640, margin: "80px auto", padding: 20 }}>
        <p>Loading...</p>
      </main>
    );
  }

  const save = async () => {
    setIsSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/rss/recommendations-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendationCap, recommendationPrompt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ text: data?.error || "Could not save recommendation settings.", kind: "error" });
        return;
      }
      setRecommendationCap(Number(data.recommendationCap) || recommendationCap);
      setRecommendationPrompt(
        typeof data.recommendationPrompt === "string" ? data.recommendationPrompt : recommendationPrompt
      );
      setNotice({ text: "Settings saved.", kind: "success" });
    } finally {
      setIsSaving(false);
    }
  };

  const charCount = recommendationPrompt.length;
  const charNearLimit = charCount > RSS_RECOMMENDATION_PROMPT_MAX_CHARS * 0.85;

  return (
    <main style={{ maxWidth: 600, margin: "44px auto", padding: "0 24px 40px" }}>
      <header style={{ borderBottom: "1px solid var(--faint)", paddingBottom: 14, marginBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 className="app-page-title settings-title">Recommendations</h1>
            <p className="app-page-subtitle settings-subtitle">
              Tune how many articles the AI recommends and what it should prioritize.
            </p>
          </div>
          <Link href="/inbox/rss" className="back-link-muted" style={{ marginTop: 4 }}>
            Back to RSS inbox
          </Link>
        </div>
      </header>

      <div style={{ display: "grid", gap: 24 }}>
        <div style={{ display: "grid", gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            Recommended article count
          </label>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            How many articles the AI selects for your recommended feed each day.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
            <input
              type="number"
              min={RSS_RECOMMENDATION_CAP_MIN}
              max={RSS_RECOMMENDATION_CAP_MAX}
              value={recommendationCap}
              onChange={(e) => setRecommendationCap(Number(e.target.value) || RSS_RECOMMENDATION_CAP_MIN)}
              className="settings-input"
              style={{ width: 90 }}
            />
            <span style={{ fontSize: 13, color: "var(--muted)" }}>
              {RSS_RECOMMENDATION_CAP_MIN}–{RSS_RECOMMENDATION_CAP_MAX} articles
            </span>
          </div>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            Interest prompt <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span>
          </label>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            Guide the AI toward topics you care about. Leave blank to use default ranking.
          </p>
          <textarea
            value={recommendationPrompt}
            onChange={(e) => setRecommendationPrompt(e.target.value.slice(0, RSS_RECOMMENDATION_PROMPT_MAX_CHARS))}
            placeholder="e.g. Prioritize startup strategy, AI tools, and deep technical explainers. Skip sports and celebrity news."
            className="settings-input"
            rows={5}
            style={{ height: "auto", padding: "10px", resize: "vertical", lineHeight: 1.5 }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <span style={{ fontSize: 12, color: charNearLimit ? "var(--danger-text, #c0392b)" : "var(--muted)" }}>
              {charCount}/{RSS_RECOMMENDATION_PROMPT_MAX_CHARS}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={save} disabled={isSaving} className="filter-action-btn">
            {isSaving ? "Saving…" : "Save settings"}
          </button>
          {notice && (
            <span style={{ fontSize: 13, color: notice.kind === "error" ? "var(--danger-text, #c0392b)" : "var(--muted)" }}>
              {notice.text}
            </span>
          )}
        </div>
      </div>
    </main>
  );
}
