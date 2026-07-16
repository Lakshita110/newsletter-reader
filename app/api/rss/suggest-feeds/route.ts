import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserRssReadProfile } from "@/lib/rss-read-profile";
import { RANKING_MODEL, openRouterChat } from "@/lib/openrouter";
import { getSessionUserId } from "@/lib/session-user";
import { normalizeRssCategory, RSS_CATEGORY_OPTIONS } from "@/lib/rss-categories";

export const dynamic = "force-dynamic";

type SuggestedFeed = {
  name: string;
  rssUrl: string;
  siteUrl: string;
  category: string;
  reason: string;
};

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI not configured" }, { status: 503 });

  const [profile, subscriptions] = await Promise.all([
    getUserRssReadProfile(userId),
    prisma.userRssSubscription.findMany({
      where: { userId, isActive: true },
      include: { source: { select: { name: true, rssUrl: true } } },
    }),
  ]);

  const currentFeeds = subscriptions.map((s) => `${s.source.name} (${s.source.rssUrl})`).join("\n");
  const profileSummary = profile.preferenceSummary.join("; ") || "No strong preference signals yet";
  const topPubs = profile.topPublications.slice(0, 6).map((p) => p.name).join(", ") || "none";

  const prompt = `You are a feed curator. Based on this reader's profile, suggest 5 RSS feeds they would genuinely enjoy that they are NOT already subscribed to.

Reader profile:
- Top publications read: ${topPubs}
- Preferences: ${profileSummary}
- Avg completion: ${profile.avgCompletionPct.toFixed(0)}%
- Recent reads (7d): ${profile.recentReadCount7d}

Currently subscribed feeds (DO NOT suggest these):
${currentFeeds || "none yet"}

Return a JSON array of exactly 5 objects with this shape:
[{"name":"Feed Name","rssUrl":"https://example.com/feed.xml","siteUrl":"https://example.com","category":"${RSS_CATEGORY_OPTIONS.join("|")}","reason":"1 sentence why this matches their interests"}]

category must be exactly one of: ${RSS_CATEGORY_OPTIONS.join(", ")}. No other values.

Rules:
- Only suggest feeds with real, working RSS URLs you are confident exist
- Vary the categories — do not suggest 3+ feeds in the same category
- reason must be specific to their profile, not generic
- Return only the JSON array, no prose`;

  const result = await openRouterChat({
    apiKey,
    model: RANKING_MODEL,
    maxTokens: 1024,
    timeoutMs: 30000,
    temperature: 0.4,
    messages: [
      { role: "system", content: "You are a helpful feed curator. Return only valid JSON." },
      { role: "user", content: prompt },
    ],
  });
  if (!result.ok) {
    return NextResponse.json({ error: "AI request failed" }, { status: 502 });
  }

  const arrayMatch = result.content.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return NextResponse.json({ error: "No suggestions returned" }, { status: 502 });

  let suggestions: SuggestedFeed[];
  try {
    const parsed = JSON.parse(arrayMatch[0]) as unknown[];
    suggestions = parsed
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => ({
        name: String(item.name ?? ""),
        rssUrl: String(item.rssUrl ?? ""),
        siteUrl: String(item.siteUrl ?? ""),
        // The model doesn't always follow the requested category enum (typos,
        // synonyms like "technology", casing) — normalize here so a suggestion
        // never carries a category the add-feed endpoint would reject with
        // "Invalid category option".
        category: normalizeRssCategory(String(item.category ?? "")) ?? "other",
        reason: String(item.reason ?? ""),
      }))
      .filter((s) => s.name && s.rssUrl.startsWith("http"));
  } catch {
    return NextResponse.json({ error: "Failed to parse suggestions" }, { status: 502 });
  }

  return NextResponse.json({ suggestions });
}
