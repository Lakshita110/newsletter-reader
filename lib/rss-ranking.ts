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

function computeMaxPerSource(cap: number, items: RankingItem[]): number {
  const raw = Number(process.env.RSS_MAX_PER_SOURCE ?? 0);
  if (Number.isFinite(raw) && raw >= 1) return Math.floor(raw);
  const uniqueSourceCount = new Set(
    items.map((i) => i.sourceName.trim().toLowerCase())
  ).size;
  if (uniqueSourceCount === 0) return cap;
  return Math.min(4, Math.ceil(cap / uniqueSourceCount));
}

function enforceSourceDiversity(
  selectedIds: string[],
  allItems: RankingItem[],
  cap: number,
  maxPerSource: number
): string[] {
  const byId = new Map<string, RankingItem>(allItems.map((item) => [item.id, item]));
  const sourceCounts = new Map<string, number>();
  const kept: string[] = [];
  const demoted: string[] = [];

  for (const id of selectedIds) {
    const item = byId.get(id);
    if (!item) continue;
    const key = item.sourceName.trim().toLowerCase();
    const count = sourceCounts.get(key) ?? 0;
    if (count < maxPerSource) {
      kept.push(id);
      sourceCounts.set(key, count + 1);
    } else {
      demoted.push(id);
    }
  }

  const selectedSet = new Set(selectedIds);
  const unselected = allItems.filter((item) => !selectedSet.has(item.id));

  for (const item of unselected) {
    if (kept.length >= cap) break;
    const key = item.sourceName.trim().toLowerCase();
    const count = sourceCounts.get(key) ?? 0;
    if (count < maxPerSource) {
      kept.push(item.id);
      sourceCounts.set(key, count + 1);
    }
  }

  for (const id of demoted) {
    if (kept.length >= cap) break;
    kept.push(id);
  }

  return kept.slice(0, cap);
}

function sanitizeAndBackfillRankedIds(rankedIds: string[], rankedItems: RankingItem[], cap: number, maxPerSource: number): string[] {
  const allowed = new Set(rankedItems.map((item) => item.id));
  const selected: string[] = [];
  for (const id of rankedIds) {
    if (!allowed.has(id)) continue;
    if (selected.includes(id)) continue;
    selected.push(id);
    if (selected.length >= cap) break;
  }
  if (selected.length < cap) {
    const selectedSet = new Set(selected);
    const sourceCounts = new Map<string, number>();
    for (const id of selected) {
      const item = rankedItems.find((i) => i.id === id);
      if (!item) continue;
      const key = item.sourceName.trim().toLowerCase();
      sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
    }
    for (const item of rankedItems) {
      if (selected.length >= cap) break;
      if (selectedSet.has(item.id)) continue;
      const key = item.sourceName.trim().toLowerCase();
      const count = sourceCounts.get(key) ?? 0;
      if (count < maxPerSource) {
        selected.push(item.id);
        selectedSet.add(item.id);
        sourceCounts.set(key, count + 1);
      }
    }
    for (const item of rankedItems) {
      if (selected.length >= cap) break;
      if (selectedSet.has(item.id)) continue;
      selected.push(item.id);
      selectedSet.add(item.id);
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
    const maxPerSource = computeMaxPerSource(params.cap, params.rankedItems);
    const sanitized = sanitizeAndBackfillRankedIds(rankedIds, params.rankedItems, params.cap, maxPerSource);
    const diversified = enforceSourceDiversity(sanitized, params.rankedItems, params.cap, maxPerSource);
    return {
      selectedIds: diversified,
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
