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

// The digest cron fires once a day at a fixed UTC time (Vercel Hobby plans
// only allow one invocation/day per cron entry, so it can't be scheduled
// per-user). digestTimezone only controls the send de-dupe date boundary,
// not the send time — so we show users what that fixed UTC time actually
// looks like in their own zone instead of implying it's locally scheduled.
const DIGEST_SEND_UTC_HOUR = 7;

function describeDigestLocalTime(tz: string): string {
  try {
    const utcInstant = new Date();
    utcInstant.setUTCHours(DIGEST_SEND_UTC_HOUR, 0, 0, 0);
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
    }).format(utcInstant);
  } catch {
    return `${DIGEST_SEND_UTC_HOUR}:00 UTC`;
  }
}

const COMMON_TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Toronto", "America/Vancouver", "America/Sao_Paulo", "America/Argentina/Buenos_Aires",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Amsterdam", "Europe/Madrid",
  "Europe/Rome", "Europe/Warsaw", "Europe/Istanbul", "Asia/Dubai", "Asia/Kolkata",
  "Asia/Singapore", "Asia/Tokyo", "Asia/Shanghai", "Asia/Seoul", "Australia/Sydney",
  "Pacific/Auckland",
];

export default function RecommendationSettingsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [recommendationCap, setRecommendationCap] = useState<number>(RSS_RECOMMENDATION_CAP_DEFAULT);
  const [recommendationPrompt, setRecommendationPrompt] = useState<string>("");
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [digestTimezone, setDigestTimezone] = useState("UTC");
  const [weeklyReadingGoal, setWeeklyReadingGoal] = useState(5);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testNotice, setTestNotice] = useState<{ text: string; kind: "success" | "error" } | null>(null);

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
      setDigestEnabled(Boolean(data.digestEnabled));
      setDigestTimezone(typeof data.digestTimezone === "string" ? data.digestTimezone : "UTC");
      setWeeklyReadingGoal(Number(data.weeklyReadingGoal) || 5);
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
        body: JSON.stringify({ recommendationCap, recommendationPrompt, digestEnabled, digestTimezone, weeklyReadingGoal }),
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
      setDigestEnabled(Boolean(data.digestEnabled));
      setDigestTimezone(typeof data.digestTimezone === "string" ? data.digestTimezone : digestTimezone);
      setWeeklyReadingGoal(Number(data.weeklyReadingGoal) || weeklyReadingGoal);
      setNotice({ text: "Settings saved.", kind: "success" });
    } finally {
      setIsSaving(false);
    }
  };

  const sendTestDigest = async () => {
    setIsSendingTest(true);
    setTestNotice(null);
    try {
      const res = await fetch("/api/rss/send-test-digest", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data?.ok) {
        setTestNotice({ text: `Sent — ${data.itemCount} article${data.itemCount === 1 ? "" : "s"}.`, kind: "success" });
      } else {
        setTestNotice({ text: data?.error || "Could not send a test digest.", kind: "error" });
      }
    } catch {
      setTestNotice({ text: "Could not reach the server.", kind: "error" });
    } finally {
      setIsSendingTest(false);
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

        <div style={{ display: "grid", gap: 8 }}>
          <label htmlFor="weekly-reading-goal" style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            Weekly reading goal
          </label>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            Number of days per week you want to read at least one article.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
            <input
              id="weekly-reading-goal"
              type="number"
              min={1}
              max={7}
              value={weeklyReadingGoal}
              onChange={(e) => setWeeklyReadingGoal(Math.max(1, Math.min(7, Number(e.target.value) || 1)))}
              className="settings-input"
              style={{ width: 90 }}
            />
            <span style={{ fontSize: 13, color: "var(--muted)" }}>days / week (1–7)</span>
          </div>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Daily email digest</label>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
              Receive your recommended reading list by email once a day, at a fixed 7:00 AM UTC send time.
            </p>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={digestEnabled}
              onChange={(e) => setDigestEnabled(e.target.checked)}
              style={{ width: 16, height: 16, cursor: "pointer" }}
            />
            <span style={{ fontSize: 13, color: "var(--text)" }}>Enable daily digest email</span>
          </label>
          {digestEnabled && (
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor="digest-timezone" style={{ fontSize: 13, color: "var(--muted)" }}>Your timezone</label>
              <select
                id="digest-timezone"
                value={digestTimezone}
                onChange={(e) => setDigestTimezone(e.target.value)}
                className="settings-input"
                style={{ maxWidth: 280 }}
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
              <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
                That&apos;s around {describeDigestLocalTime(digestTimezone)} in {digestTimezone.replace(/_/g, " ")}.
                Used to figure out your &quot;today&quot; for de-duping — not to move the send time.
              </p>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              onClick={sendTestDigest}
              disabled={isSendingTest}
              className="filter-action-btn"
              style={{ width: "fit-content" }}
            >
              {isSendingTest ? "Sending…" : "Send test email now"}
            </button>
            {testNotice && (
              <span style={{ fontSize: 13, color: testNotice.kind === "error" ? "var(--danger-text, #c0392b)" : "var(--muted)" }}>
                {testNotice.text}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button type="button" onClick={save} disabled={isSaving} className="filter-action-btn">
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
