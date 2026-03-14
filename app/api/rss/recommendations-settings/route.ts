import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  normalizeRecommendationCap,
  normalizeRecommendationPrompt,
  RSS_RECOMMENDATION_CAP_DEFAULT,
  RSS_RECOMMENDATION_CAP_MAX,
  RSS_RECOMMENDATION_CAP_MIN,
  RSS_RECOMMENDATION_PROMPT_MAX_CHARS,
} from "@/lib/rss-recommendation-settings";

async function getOrCreateUser() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      rssRecommendationCap: RSS_RECOMMENDATION_CAP_DEFAULT,
    },
    select: {
      id: true,
      rssRecommendationCap: true,
      rssRecommendationPrompt: true,
    },
  });
}

export async function GET() {
  const user = await getOrCreateUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
  const user = await getOrCreateUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const hasCap = Object.prototype.hasOwnProperty.call(body, "recommendationCap");
  const hasPrompt = Object.prototype.hasOwnProperty.call(body, "recommendationPrompt");

  if (!hasCap && !hasPrompt) {
    return NextResponse.json({ error: "No settings provided" }, { status: 400 });
  }

  const data: { rssRecommendationCap?: number; rssRecommendationPrompt?: string | null } = {};
  if (hasCap) {
    data.rssRecommendationCap = normalizeRecommendationCap(body?.recommendationCap);
  }
  if (hasPrompt) {
    if (typeof body?.recommendationPrompt !== "string") {
      return NextResponse.json({ error: "recommendationPrompt must be a string" }, { status: 400 });
    }
    data.rssRecommendationPrompt = normalizeRecommendationPrompt(body.recommendationPrompt);
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data,
    select: {
      rssRecommendationCap: true,
      rssRecommendationPrompt: true,
    },
  });

  return NextResponse.json({
    ok: true,
    recommendationCap: normalizeRecommendationCap(updated.rssRecommendationCap),
    recommendationPrompt: updated.rssRecommendationPrompt ?? "",
  });
}
