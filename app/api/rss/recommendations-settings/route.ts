import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  normalizeRecommendationCap,
  normalizeRecommendationPrompt,
  RSS_RECOMMENDATION_CAP_MAX,
  RSS_RECOMMENDATION_CAP_MIN,
  RSS_RECOMMENDATION_PROMPT_MAX_CHARS,
} from "@/lib/rss-recommendation-settings";
import { getSessionUserId } from "@/lib/session-user";

export const dynamic = "force-dynamic";

/** The two ranking knobs: how many stories to pick a day, and what to favor. */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { rssRecommendationCap: true, rssRecommendationPrompt: true },
  });
  return NextResponse.json({
    recommendationCap: normalizeRecommendationCap(user.rssRecommendationCap),
    recommendationPrompt: user.rssRecommendationPrompt ?? "",
    limits: {
      minCap: RSS_RECOMMENDATION_CAP_MIN,
      maxCap: RSS_RECOMMENDATION_CAP_MAX,
      maxPromptChars: RSS_RECOMMENDATION_PROMPT_MAX_CHARS,
    },
  });
}

export async function PATCH(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const data: { rssRecommendationCap?: number; rssRecommendationPrompt?: string | null } = {};
  if (body?.recommendationCap !== undefined) {
    data.rssRecommendationCap = normalizeRecommendationCap(body.recommendationCap);
  }
  if (body?.recommendationPrompt !== undefined) {
    if (typeof body.recommendationPrompt !== "string") {
      return NextResponse.json({ error: "recommendationPrompt must be a string" }, { status: 400 });
    }
    data.rssRecommendationPrompt = normalizeRecommendationPrompt(body.recommendationPrompt);
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No settings provided" }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: { rssRecommendationCap: true, rssRecommendationPrompt: true },
  });
  return NextResponse.json({
    recommendationCap: normalizeRecommendationCap(updated.rssRecommendationCap),
    recommendationPrompt: updated.rssRecommendationPrompt ?? "",
  });
}
