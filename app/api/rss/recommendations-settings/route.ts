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
import { normalizeDigestEmail } from "@/lib/send-daily-digest";

const userSelect = {
  id: true,
  email: true,
  rssRecommendationCap: true,
  rssRecommendationPrompt: true,
  digestEnabled: true,
  digestEmail: true,
  digestTimezone: true,
  weeklyReadingGoal: true,
} as const;

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
    select: userSelect,
  });
}

export async function GET() {
  const user = await getOrCreateUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({
    recommendationCap: normalizeRecommendationCap(user.rssRecommendationCap),
    recommendationPrompt: user.rssRecommendationPrompt ?? "",
    digestEnabled: user.digestEnabled,
    // Empty string when unset; the account email is the effective destination.
    digestEmail: user.digestEmail ?? "",
    accountEmail: user.email,
    digestTimezone: user.digestTimezone,
    weeklyReadingGoal: user.weeklyReadingGoal,
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
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

  if (!has("recommendationCap") && !has("recommendationPrompt") &&
      !has("digestEnabled") && !has("digestEmail") && !has("digestTimezone") && !has("weeklyReadingGoal")) {
    return NextResponse.json({ error: "No settings provided" }, { status: 400 });
  }

  const data: Parameters<typeof prisma.user.update>[0]["data"] = {};

  if (has("recommendationCap")) {
    data.rssRecommendationCap = normalizeRecommendationCap(body?.recommendationCap);
  }
  if (has("recommendationPrompt")) {
    if (typeof body?.recommendationPrompt !== "string") {
      return NextResponse.json({ error: "recommendationPrompt must be a string" }, { status: 400 });
    }
    data.rssRecommendationPrompt = normalizeRecommendationPrompt(body.recommendationPrompt);
  }
  if (has("digestEnabled")) {
    data.digestEnabled = Boolean(body.digestEnabled);
  }
  if (has("digestEmail")) {
    // Blank clears the override (fall back to the account email). A non-blank
    // value must look like an email, else we'd silently send nowhere.
    const raw = body.digestEmail;
    if (typeof raw !== "string") {
      return NextResponse.json({ error: "digestEmail must be a string" }, { status: 400 });
    }
    if (raw.trim() === "") {
      data.digestEmail = null;
    } else {
      const normalized = normalizeDigestEmail(raw);
      if (!normalized) {
        return NextResponse.json({ error: "digestEmail must be a valid email address" }, { status: 400 });
      }
      data.digestEmail = normalized;
    }
  }
  if (has("digestTimezone")) {
    if (typeof body.digestTimezone !== "string" || body.digestTimezone.trim().length === 0) {
      return NextResponse.json({ error: "digestTimezone must be a non-empty string" }, { status: 400 });
    }
    data.digestTimezone = body.digestTimezone.trim();
  }
  if (has("weeklyReadingGoal")) {
    data.weeklyReadingGoal = Math.max(1, Math.min(30, Math.round(Number(body.weeklyReadingGoal) || 1)));
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data,
    select: userSelect,
  });

  return NextResponse.json({
    ok: true,
    recommendationCap: normalizeRecommendationCap(updated.rssRecommendationCap),
    recommendationPrompt: updated.rssRecommendationPrompt ?? "",
    digestEnabled: updated.digestEnabled,
    digestEmail: updated.digestEmail ?? "",
    accountEmail: updated.email,
    digestTimezone: updated.digestTimezone,
    weeklyReadingGoal: updated.weeklyReadingGoal,
  });
}
