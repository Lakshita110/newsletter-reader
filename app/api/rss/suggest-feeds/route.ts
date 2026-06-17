import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserRssReadProfile } from "@/lib/rss-helpers";

export const dynamic = "force-dynamic";

type SuggestedFeed = {
  name: string;
  rssUrl: string;
  siteUrl: string;
  category: string;
  reason: string;
};

type OpenRouterResponse = {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
};

function contentToString(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((p) => (typeof p?.text === "string" ? p.text : "")).join("\n").trim();
}

async function getUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  const user = await prisma.user.upsert({ where: { email }, update: {}, create: { email }, select: { id: true } });
  return user.id;
}

export async function GET() {
  const userId = await getUserId();
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
[{"name":"Feed Name","rssUrl":"https://example.com/feed.xml","siteUrl":"https://example.com","category":"tech|science|business|culture|news|other","reason":"1 sentence why this matches their interests"}]

Rules:
- Only suggest feeds with real, working RSS URLs you are confident exist
- Vary the categories — do not suggest 3+ feeds in the same category
- reason must be specific to their profile, not generic
- Return only the JSON array, no prose`;

  const model = process.env.OPENROUTER_MODEL ?? "gpt-4o-mini";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  let raw = "";
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(process.env.OPENROUTER_SITE_URL ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL } : {}),
        ...(process.env.OPENROUTER_APP_NAME ? { "X-Title": process.env.OPENROUTER_APP_NAME } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 1024,
        messages: [
          { role: "system", content: "You are a helpful feed curator. Return only valid JSON." },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = (await res.json()) as OpenRouterResponse;
    raw = contentToString(data.choices?.[0]?.message?.content);
  } finally {
    clearTimeout(timer);
  }

  const arrayMatch = raw.match(/\[[\s\S]*\]/);
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
        category: String(item.category ?? "other"),
        reason: String(item.reason ?? ""),
      }))
      .filter((s) => s.name && s.rssUrl.startsWith("http"));
  } catch {
    return NextResponse.json({ error: "Failed to parse suggestions" }, { status: 502 });
  }

  return NextResponse.json({ suggestions });
}
