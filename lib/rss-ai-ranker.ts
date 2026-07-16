import { RANKING_MODEL_CHAIN, openRouterChat } from "@/lib/openrouter";

type RankItemInput = {
  id: string;
  title: string;
  snippet?: string | null;
  author?: string | null;
  sourceName?: string | null;
  publishedAtIso: string;
};

type RankRequest = {
  dayKey: string;
  cap: number;
  items: RankItemInput[];
  userProfile?: {
    topPublications: Array<{ name: string; score: number }>;
    avgCompletionPct: number;
    recentReadCount7d: number;
    preferenceSummary: string[];
    customPrompt?: string | null;
  };
};

type RankResult = {
  ids: string[];
  reasons: Record<string, string>;
  /** The model that produced this ranking; null when no AI call was made. */
  model: string | null;
};

type RankCacheEntry = {
  expiresAt: number;
  value: RankResult | null;
  reason: string;
};

const rankCache = new Map<string, RankCacheEntry>();
const inFlightRankings = new Map<string, Promise<RankResult | null>>();
let providerCooldownUntilMs = 0;

type ParsedPick = { rawId: string | number; reason: string };

/**
 * Parse the model's `{"picks":[{"id":"rss:x","reason":"..."}, ...]}` output.
 * id and reason are read from the SAME object, so a truncated response
 * (finish_reason="length") can only ever lose whole trailing picks, never an
 * id whose reason got cut off separately — the old format asked for a
 * parallel `ids` array and `reasons` map, recovered by two independent
 * regexes on truncation, which routinely salvaged different counts from each
 * and left ids without a matching reason.
 */
export function parsePicks(content: string): ParsedPick[] {
  if (!content) return [];

  // Preferred path: the whole envelope parses cleanly.
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { picks?: unknown };
      if (Array.isArray(parsed.picks)) {
        const out: ParsedPick[] = [];
        for (const entry of parsed.picks) {
          if (!entry || typeof entry !== "object") continue;
          const { id, reason } = entry as { id?: unknown; reason?: unknown };
          if ((typeof id === "string" || typeof id === "number") && typeof reason === "string" && reason.trim()) {
            out.push({ rawId: id, reason: reason.trim() });
          }
        }
        if (out.length > 0) return out;
      }
    }
  } catch {
    /* fall through to regex recovery below */
  }

  // Recovery: truncated or otherwise malformed output. Salvage every complete
  // {"id":...,"reason":"..."} object still present (either key order) — a
  // cut-off tail then loses only its final partial pick, and every pick that
  // does survive still has both fields.
  const out: ParsedPick[] = [];
  const idFirst =
    /\{\s*"id"\s*:\s*(?:"(rss:[A-Za-z0-9_-]+)"|(\d+))\s*,\s*"reason"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
  const reasonFirst =
    /\{\s*"reason"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"id"\s*:\s*(?:"(rss:[A-Za-z0-9_-]+)"|(\d+))\s*\}/g;
  const unescape = (s: string) => s.replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
  let match: RegExpExecArray | null;
  while ((match = idFirst.exec(content)) !== null) {
    const rawId = match[1] ?? Number(match[2]);
    const reason = unescape(match[3]);
    if (reason) out.push({ rawId, reason });
  }
  if (out.length === 0) {
    while ((match = reasonFirst.exec(content)) !== null) {
      const rawId = match[2] ?? Number(match[3]);
      const reason = unescape(match[1]);
      if (reason) out.push({ rawId, reason });
    }
  }
  return out;
}

function normalizeRankToken(
  token: string | number,
  byIndex: Map<number, string>
): string | undefined {
  if (typeof token === "number") {
    const n = Math.floor(token);
    return byIndex.get(n) ?? byIndex.get(n + 1);
  }

  const trimmed = token.trim();
  const embeddedId = trimmed.match(/\brss:[A-Za-z0-9_-]+\b/)?.[0];
  if (embeddedId) return embeddedId;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && trimmed.match(/^\d+$/)) {
    const n = Math.floor(numeric);
    return byIndex.get(n) ?? byIndex.get(n + 1);
  }

  return trimmed;
}

function getCacheKey(req: RankRequest, model: string): string {
  const ids = req.items.map((item) => item.id).join(",");
  const profileHint = req.userProfile?.topPublications
    ?.slice(0, 5)
    .map((p) => p.name)
    .join(",") ?? "none";
  return `${model}|${req.dayKey}|${req.cap}|${ids}|${profileHint}`;
}

function getCacheTtlMs(): number {
  const ttl = Number(process.env.OPENROUTER_RANK_CACHE_TTL_MS ?? 10 * 60 * 1000);
  if (!Number.isFinite(ttl) || ttl < 1000) return 10 * 60 * 1000;
  return ttl;
}

function getFailureCooldownMs(): number {
  const ms = Number(process.env.OPENROUTER_FAILURE_COOLDOWN_MS ?? 60 * 1000);
  if (!Number.isFinite(ms) || ms < 1000) return 60 * 1000;
  return ms;
}

function maybeExtractResetMs(errorBody: string): number | null {
  try {
    const parsed = JSON.parse(errorBody) as {
      error?: {
        metadata?: { headers?: { "X-RateLimit-Reset"?: string } };
      };
    };
    const raw = parsed.error?.metadata?.headers?.["X-RateLimit-Reset"];
    if (!raw) return null;
    const reset = Number(raw);
    if (!Number.isFinite(reset) || reset <= Date.now()) return null;
    return reset;
  } catch {
    return null;
  }
}

function withTimeoutMs(): number {
  const ms = Number(process.env.OPENROUTER_TIMEOUT_MS ?? 300000);
  if (!Number.isFinite(ms) || ms < 1000) return 300000;
  return ms;
}

export function withMaxTokens(cap: number): number {
  // Each pick is one {"id":"rss:x","reason":"..."} object: an id (~10 tokens),
  // a short reason (<=8 words, ~12 tokens), plus the object's own
  // braces/keys/quoting (~14 tokens) — call it ~36 tokens/item, plus envelope
  // headroom. Even if this runs low and truncation still happens, atomic picks
  // mean a cut tail just drops whole trailing items rather than splitting an
  // id from its reason.
  return Math.min(4096, Math.max(512, 256 + cap * 36));
}

export async function rankItemsForDailyCap(req: RankRequest): Promise<RankResult | null> {
  if (req.cap <= 0) return { ids: [], reasons: {}, model: null };
  if (req.items.length === 0) return { ids: [], reasons: {}, model: null };

  // Previously skipped the AI call entirely when candidates already fit
  // within the cap, returning every id with an empty reasons map. That meant
  // "why?" pills never showed at all on any day the candidate pool was small
  // — always call the ranker so every selected item gets a real reason.

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.warn("[rss-ranker] OPENROUTER_API_KEY missing, skipping AI ranking");
    return null;
  }

  if (Date.now() < providerCooldownUntilMs) {
    console.warn(
      `[rss-ranker] provider cooldown active until ${new Date(providerCooldownUntilMs).toISOString()}, skipping AI ranking`
    );
    return null;
  }

  const modelsToTry = RANKING_MODEL_CHAIN;
  const cacheKey = getCacheKey(req, modelsToTry.join("|"));
  const cached = rankCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    console.info(
      `[rss-ranker] cache hit day="${req.dayKey}" reason="${cached.reason}" cachedResult=${cached.value ? cached.value.ids.length : 0}`
    );
    return cached.value ? { ...cached.value } : null;
  }
  const inFlight = inFlightRankings.get(cacheKey);
  if (inFlight) {
    console.info(
      `[rss-ranker] join in-flight request day="${req.dayKey}" cap=${req.cap}`
    );
    const shared = await inFlight;
    return shared ? { ...shared } : null;
  }

  const candidates = req.items
    .map((item, index) => {
      const snippetLine = item.snippet?.trim()
        ? `snippet=${item.snippet.trim().slice(0, 150)}`
        : null;
      const dateLine = item.publishedAtIso
        ? `published=${item.publishedAtIso.slice(0, 10)}`
        : null;
      return [
        `${index + 1}. id=${item.id}`,
        `source=${item.sourceName?.trim() || "unknown"}`,
        `title=${item.title}`,
        `author=${item.author ?? "unknown"}`,
        snippetLine,
        dateLine,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  const validIds = req.items.map((item) => item.id).join(", ");

  const topPubsLine =
    req.userProfile?.topPublications?.length
      ? req.userProfile.topPublications
          .slice(0, 8)
          .map((p) => `${p.name}(${p.score.toFixed(1)})`)
          .join(", ")
      : "none";
  const profileNotes =
    req.userProfile?.preferenceSummary?.length
      ? req.userProfile.preferenceSummary.map((x) => `- ${x}`).join("\n")
      : "- no strong preference signals yet";

  const defaultInterestPrompt =
    "Prioritize personal relevance, quality, diversity, novelty, and recency. Avoid near-duplicates and politics-only lists. Include culture coverage, at least 1 strong tech item, and 1-2 deeper pieces when available.";
  const customInterestPrompt = req.userProfile?.customPrompt?.trim();
  const uniqueSourceCount = new Set(
    req.items.map((item) => item.sourceName?.trim().toLowerCase()).filter((value): value is string => Boolean(value))
  ).size;
  const targetUniqueSources = Math.min(uniqueSourceCount, Math.max(1, Math.min(req.cap, 8)));

  const prompt =
    `Pick the best ${Math.min(req.cap, req.items.length)} RSS items for this user and order them best-to-worst.

` +
    `Context:
` +
    `day=${req.dayKey}

` +
    `User profile:
` +
    `top_publications=${topPubsLine}
` +
    `avg_completion_pct=${req.userProfile?.avgCompletionPct ?? 0}
` +
    `recent_reads_7d=${req.userProfile?.recentReadCount7d ?? 0}
` +
    `${profileNotes}

` +
    `Interest guidance:
` +
    `${customInterestPrompt ? `User-stated interests: ${customInterestPrompt}` : defaultInterestPrompt}

` +
    `Diversity guidance:
` +
    `Favor a varied set of publishers. Do not choose more than 1 article from the same source unless that source has a clearly stronger candidate than all others. Avoid selecting 3 or more items from the same publisher, and avoid publisher-heavy blocks such as multiple New Yorker stories in a row.

` +
    `Source coverage:
` +
    `Aim for at least ${targetUniqueSources} distinct sources when possible, while still prioritizing overall relevance.

` +
    `Return exactly one line of JSON only: {"picks":[{"id":"rss:xxx","reason":"<=8 words why"}, ...]}
` +
    `Rules: order best-to-worst, exactly ${Math.min(req.cap, req.items.length)} picks, unique ids, every id must be from: ${validIds}. Every pick object must have both "id" and "reason" — never emit an id without its reason.

` +
    `Candidates:
${candidates}`;

  const rankingPromise = (async (): Promise<RankResult | null> => {
    console.info(
      `[rss-ranker] ranking start day="${req.dayKey}" cap=${req.cap} candidates=${req.items.length} models="${modelsToTry.join(",")}"`
    );
    const timeoutMs = withTimeoutMs();
    let content: string | null = null;
    let finishReason: string | undefined;
    let usedModel: string | null = null;

    for (let attemptIndex = 0; attemptIndex < modelsToTry.length; attemptIndex++) {
      const selectedModel = modelsToTry[attemptIndex];
      const result = await openRouterChat({
        apiKey,
        model: selectedModel,
        maxTokens: withMaxTokens(req.cap),
        timeoutMs,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content:
              "You are a ranking engine. Output exactly one-line JSON matching the requested schema with no extra text.",
          },
          { role: "user", content: prompt },
        ],
      });

      if (!result.ok) {
        const resetMs = result.status === 429 ? maybeExtractResetMs(result.errorBody) : null;
        if (resetMs) {
          providerCooldownUntilMs = resetMs;
        } else if (result.status === 429) {
          providerCooldownUntilMs = Date.now() + getFailureCooldownMs();
        }
        console.warn(
          `[rss-ranker] model attempt failed model="${selectedModel}" attempt=${attemptIndex + 1}/${modelsToTry.length} status=${result.status ?? "thrown"} body="${result.errorBody.slice(0, 240)}"`
        );
        continue;
      }

      content = result.content;
      finishReason = result.finishReason;
      usedModel = selectedModel;
      if (attemptIndex > 0) {
        console.info(`[rss-ranker] ranking succeeded using fallback model="${selectedModel}"`);
      }
      break;
    }

    if (content === null) {
      rankCache.set(cacheKey, {
        expiresAt: Date.now() + getFailureCooldownMs(),
        value: null,
        reason: "request_failed",
      });
      return null;
    }

    if (!content) {
      console.warn(`[rss-ranker] empty content returned model="${usedModel}"`);
    }
    if (finishReason === "length") {
      console.warn(
        `[rss-ranker] output truncated (finish_reason=length, cap=${req.cap}) — raise withMaxTokens; trailing picks may be lost`
      );
    }
    const picks = parsePicks(content);
    if (picks.length === 0) {
      console.warn(
        `[rss-ranker] invalid/empty picks returned contentPreview="${content.slice(0, 200)}"`
      );
      rankCache.set(cacheKey, {
        expiresAt: Date.now() + getFailureCooldownMs(),
        value: null,
        reason: "invalid_output",
      });
      return null;
    }

    const allowed = new Set(req.items.map((it) => it.id));
    const byIndex = new Map<number, string>();
    for (let i = 0; i < req.items.length; i++) {
      byIndex.set(i + 1, req.items[i].id);
    }
    // Every entry in `deduped` came from one atomic {id, reason} pick, so ids
    // and reasons stay paired by construction — no separate recovery pass
    // that could salvage a different count of each.
    const deduped: ParsedPick[] = [];
    const seenIds = new Set<string>();
    for (const pick of picks) {
      const id = normalizeRankToken(pick.rawId, byIndex);
      if (!id) continue;
      if (!allowed.has(id)) continue;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      deduped.push({ rawId: id, reason: pick.reason });
    }
    if (deduped.length === 0) {
      console.warn(
        `[rss-ranker] picks filtered out to empty set idPreview="${picks
          .slice(0, 8)
          .map((pick) => String(pick.rawId).slice(0, 80))
          .join(" | ")}"`
      );
      rankCache.set(cacheKey, {
        expiresAt: Date.now() + getFailureCooldownMs(),
        value: null,
        reason: "filtered_empty",
      });
      return null;
    }
    const limited = deduped.slice(0, req.cap);
    const ids = limited.map((pick) => pick.rawId as string);
    const reasons: Record<string, string> = {};
    for (const pick of limited) reasons[pick.rawId as string] = pick.reason;

    console.info(`[rss-ranker] ranking success selected=${ids.length} reasons=${Object.keys(reasons).length}`);
    const rankResult: RankResult = { ids, reasons, model: usedModel };
    rankCache.set(cacheKey, {
      expiresAt: Date.now() + getCacheTtlMs(),
      value: rankResult,
      reason: "success",
    });
    return rankResult;
  })();

  inFlightRankings.set(cacheKey, rankingPromise);
  try {
    const result = await rankingPromise;
    return result ? { ...result } : null;
  } finally {
    inFlightRankings.delete(cacheKey);
  }
}
