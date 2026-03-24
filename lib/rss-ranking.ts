import { createHash } from "crypto";
import { rankItemsForDailyCap } from "@/lib/rss-daily-cap-ranker";
import { type RssReadProfile, getUserRssReadProfile } from "@/lib/rss-helpers";

export type RankingItem = {
  id: string;
  title: string;
  snippet: string;
  author: string | null;
  sourceName: string;
  publishedAtIso: string;
};

export function buildRankInputFingerprint(
  dayKey: string,
  cap: number,
  prompt: string,
  items: Array<{ id: string }>
): string {
  const payload = `${dayKey}|${cap}|${prompt}|${items.map((item) => item.id).join(",")}`;
  return createHash("sha256").update(payload).digest("hex");
}

function sanitizeAndBackfillRankedIds(rankedIds: string[], rankedItems: RankingItem[], cap: number): string[] {
  const allowed = new Set(rankedItems.map((item) => item.id));
  const selected: string[] = [];
  for (const id of rankedIds) {
    if (!allowed.has(id)) continue;
    if (selected.includes(id)) continue;
    selected.push(id);
    if (selected.length >= cap) break;
  }
  if (selected.length < cap) {
    for (const item of rankedItems) {
      if (selected.includes(item.id)) continue;
      selected.push(item.id);
      if (selected.length >= cap) break;
    }
  }
  return selected;
}

function sanitizeRecommendedIds(rankedIds: string[], rankedItems: RankingItem[], cap: number): string[] {
  const allowed = new Set(rankedItems.map((item) => item.id));
  const selected: string[] = [];
  for (const id of rankedIds) {
    if (!allowed.has(id)) continue;
    if (selected.includes(id)) continue;
    selected.push(id);
    if (selected.length >= cap) break;
  }
  return selected;
}

export async function computeDailyRankedSelection(params: {
  userId: string;
  dayKey: string;
  cap: number;
  rankedItems: RankingItem[];
  customPrompt?: string | null;
  readProfile?: RssReadProfile;
}): Promise<{
  selectedIds: string[];
  recommendedIds: string[];
  status: "AI_SUCCESS" | "FALLBACK_DETERMINISTIC";
  inputFingerprint: string;
}> {
  const normalizedPrompt = params.customPrompt?.trim() ?? "";
  const inputFingerprint = buildRankInputFingerprint(params.dayKey, params.cap, normalizedPrompt, params.rankedItems);
  const deterministicIds =
    params.cap <= 0 ? [] : params.rankedItems.slice(0, params.cap).map((item) => item.id);

  if (params.cap <= 0 || params.rankedItems.length === 0) {
    return {
      selectedIds: [],
      recommendedIds: [],
      status: "FALLBACK_DETERMINISTIC",
      inputFingerprint,
    };
  }

  const readProfile =
    params.readProfile ?? {
      ...(await getUserRssReadProfile(params.userId)),
      customPrompt: normalizedPrompt || null,
    };
  const rankedIds = await rankItemsForDailyCap({
    sourceName: "All RSS Sources",
    dayKey: params.dayKey,
    category: "mixed",
    cap: params.cap,
    userProfile: { ...readProfile, customPrompt: normalizedPrompt || null },
    items: params.rankedItems,
  }).catch(() => null);

  if (rankedIds && rankedIds.length > 0) {
    return {
      selectedIds: sanitizeAndBackfillRankedIds(rankedIds, params.rankedItems, params.cap),
      recommendedIds: sanitizeRecommendedIds(rankedIds, params.rankedItems, params.cap),
      status: "AI_SUCCESS",
      inputFingerprint,
    };
  }

  return {
    selectedIds: deterministicIds,
    recommendedIds: [],
    status: "FALLBACK_DETERMINISTIC",
    inputFingerprint,
  };
}
