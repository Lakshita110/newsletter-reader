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

// How many extra items beyond the final cap we ask the AI to rank, so that
// after trimming over-represented publishers there are still enough reasoned
// picks left to fill the cap.
const DIVERSITY_OVERFETCH = 20;

// Trim the AI's over-fetched ranked list down to `cap` while spreading picks
// across publishers, keeping every kept id one the AI actually ranked (so it
// still has a reason) instead of backfilling with un-reasoned filler. Round-
// robins by rank: hand each source its best pick first, then its 2nd-best,
// etc., raising the per-source allowance only when the feed still isn't full.
// This converges on the smallest max-per-source that fills the cap. An
// optional RSS_MAX_PER_SOURCE hard-caps the allowance (feed may end up
// shorter than cap if the AI's pool can't support it).
export function diversityTrim(rankedIds: string[], rankedItems: RankingItem[], cap: number): string[] {
  const byId = new Map<string, RankingItem>(rankedItems.map((item) => [item.id, item]));
  const sourceOf = (id: string) => byId.get(id)?.sourceName.trim().toLowerCase() ?? "";

  const valid: string[] = [];
  const seen = new Set<string>();
  for (const id of rankedIds) {
    if (!byId.has(id) || seen.has(id)) continue;
    seen.add(id);
    valid.push(id);
  }
  if (valid.length <= cap) return valid;

  const envCapRaw = Number(process.env.RSS_MAX_PER_SOURCE ?? 0);
  const maxAllowance = Number.isFinite(envCapRaw) && envCapRaw >= 1 ? Math.floor(envCapRaw) : Infinity;

  const kept: string[] = [];
  const keptSet = new Set<string>();
  const counts = new Map<string, number>();
  for (let allowance = 1; allowance <= maxAllowance && kept.length < cap; allowance++) {
    let progressed = false;
    for (const id of valid) {
      if (kept.length >= cap) break;
      if (keptSet.has(id)) continue;
      const src = sourceOf(id);
      if ((counts.get(src) ?? 0) < allowance) {
        kept.push(id);
        keptSet.add(id);
        counts.set(src, (counts.get(src) ?? 0) + 1);
        progressed = true;
      }
    }
    // No id added at this allowance: every remaining source is saturated, so
    // only a higher allowance helps. Bail once everything has been kept
    // (can't happen given valid.length > cap, but guards an infinite loop).
    if (!progressed && keptSet.size >= valid.length) break;
  }

  return kept.slice(0, cap);
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
  rankReasons: Record<string, string>;
  status: "AI_SUCCESS" | "FALLBACK_DETERMINISTIC";
  /** The model that produced the ranking; null on deterministic fallback. */
  model: string | null;
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
      rankReasons: {},
      status: "FALLBACK_DETERMINISTIC",
      model: null,
      inputFingerprint,
    };
  }

  const readProfile =
    params.readProfile ?? {
      ...(await getUserRssReadProfile(params.userId)),
      customPrompt: normalizedPrompt || null,
    };
  // Over-fetch beyond the final cap so the diversity trim below still has
  // enough reasoned picks left to fill the cap after dropping over-
  // represented publishers.
  const rankCap = Math.min(params.rankedItems.length, params.cap + DIVERSITY_OVERFETCH);
  const rankResult = await rankItemsForDailyCap({
    sourceName: "All RSS Sources",
    dayKey: params.dayKey,
    category: "mixed",
    cap: rankCap,
    userProfile: { ...readProfile, customPrompt: normalizedPrompt || null },
    items: params.rankedItems,
  }).catch(() => null);

  const rankedIds = rankResult?.ids ?? null;
  const reasons = rankResult?.reasons ?? {};
  if (rankedIds && rankedIds.length > 0) {
    // selectedIds: the AI's full ranked set, trimmed only for publisher
    // diversity — this drives general ordering/overflow and must not shrink
    // just because a reason is missing for some picks.
    // recommendedIds: the subset of the trimmed set the AI actually
    // explained. rankItemsForDailyCap now parses id+reason as one atomic
    // pick, so every id it returns already has a reason by construction —
    // this filter is a cheap defense-in-depth check, not the mechanism
    // relied on to keep the two in sync.
    const aiPicks = diversityTrim(rankedIds, params.rankedItems, params.cap);
    const reasonedPicks = aiPicks.filter((id) => Boolean(reasons[id]));
    return {
      selectedIds: aiPicks,
      recommendedIds: reasonedPicks,
      rankReasons: reasons,
      status: "AI_SUCCESS",
      model: rankResult?.model ?? null,
      inputFingerprint,
    };
  }

  return {
    selectedIds: deterministicIds,
    recommendedIds: [],
    rankReasons: {},
    status: "FALLBACK_DETERMINISTIC",
    model: null,
    inputFingerprint,
  };
}
