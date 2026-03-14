"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  RSS_RECOMMENDATION_CAP_MAX,
  RSS_RECOMMENDATION_CAP_MIN,
  RSS_RECOMMENDATION_PROMPT_MAX_CHARS,
} from "@/lib/rss-recommendation-settings";

export default function RecommendationSettingsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [recommendationCap, setRecommendationCap] = useState<number>(35);
  const [recommendationPrompt, setRecommendationPrompt] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
      setRecommendationCap(Number(data.recommendationCap) || 35);
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
        setNotice(data?.error || "Could not save recommendation settings.");
        return;
      }
      setRecommendationCap(Number(data.recommendationCap) || recommendationCap);
      setRecommendationPrompt(
        typeof data.recommendationPrompt === "string" ? data.recommendationPrompt : recommendationPrompt
      );
      setNotice("Saved.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main style={{ maxWidth: 720, margin: "44px auto", padding: "0 24px 20px" }}>
      <header style={{ borderBottom: "1px solid var(--faint)", paddingBottom: 12, marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 className="app-page-title settings-title">Manage Recommendations</h1>
            <p className="app-page-subtitle settings-subtitle">
              Tune how many recommended RSS articles you see and what interests the AI should prioritize.
            </p>
          </div>
          <Link href="/rss/settings" className="back-link-muted">
            Back to RSS settings
          </Link>
        </div>
      </header>

      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
          <span style={{ color: "var(--muted)" }}>Recommended article count</span>
          <input
            type="number"
            min={RSS_RECOMMENDATION_CAP_MIN}
            max={RSS_RECOMMENDATION_CAP_MAX}
            value={recommendationCap}
            onChange={(e) => setRecommendationCap(Number(e.target.value) || RSS_RECOMMENDATION_CAP_MIN)}
            className="settings-input"
          />
        </label>

        <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
          <span style={{ color: "var(--muted)" }}>Interest prompt for AI (optional)</span>
          <textarea
            value={recommendationPrompt}
            onChange={(e) => setRecommendationPrompt(e.target.value.slice(0, RSS_RECOMMENDATION_PROMPT_MAX_CHARS))}
            placeholder="Example: prioritize startup strategy, AI tools, and deep technical explainers."
            className="settings-input"
            rows={6}
          />
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            {recommendationPrompt.length}/{RSS_RECOMMENDATION_PROMPT_MAX_CHARS}
          </span>
        </label>

        <div>
          <button onClick={save} disabled={isSaving} className="filter-action-btn">
            {isSaving ? "Saving..." : "Save recommendation settings"}
          </button>
        </div>
      </div>

      {notice && <div style={{ marginTop: 14, color: "var(--muted)", fontSize: 13 }}>{notice}</div>}
    </main>
  );
}
