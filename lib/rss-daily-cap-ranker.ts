type RankItemInput = {
  id: string;
  title: string;
  snippet?: string | null;
  author?: string | null;
  sourceName?: string | null;
  publishedAtIso: string;
};

type RankRequest = {
  sourceName: string;
  dayKey: string;
  category: string;
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

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

type RankResult = { ids: string[]; reasons: Record<string, string> };

type RankCacheEntry = {
  expiresAt: number;
  value: RankResult | null;
  reason: string;
};

const rankCache = new Map<string, RankCacheEntry>();
const inFlightRankings = new Map<string, Promise<RankResult | null>>();
let providerCooldownUntilMs = 0;

// Model chain is hard-pinned in code (not read from env) because the production
// Vercel env is temporarily unreachable and we need to force these models. The
// chain is tried in order: gpt-4o-mini first, then gemini-flash if it fails.
// Revert to the env-based reads (OPENROUTER_MODEL / OPENROUTER_FALLBACK_MODELS)
// once env access is restored.
const RANKING_MODEL = "openai/gpt-4o-mini";
const RANKING_FALLBACK_MODELS = ["google/gemini-2.0-flash-001"];

function contentToString(
  content: string | Array<{ type?: string; text?: string }> | undefined
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
}

function parseRankedTokens(raw: string): Array<string | number> | null {
  if (!raw) return null;
  const firstJson = raw.match(/\{[\s\S]*\}/);
  const candidate = firstJson?.[0] ?? raw;
  try {
    const parsed = JSON.parse(candidate) as {
      ids?: unknown;
      indexes?: unknown;
      indices?: unknown;
      selected?: unknown;
      ranked_ids?: unknown;
      rankedIds?: unknown;
    };
    const pick =
      parsed.ids ??
      parsed.ranked_ids ??
      parsed.rankedIds ??
      parsed.indexes ??
      parsed.indices ??
      parsed.selected;
    if (!Array.isArray(pick)) return null;
    return pick.filter(
      (value): value is string | number =>
        typeof value === "string" || (typeof value === "number" && Number.isFinite(value))
    );
  } catch {
    const lines = raw
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (lines.length === 0) return null;
    const tokens: Array<string | number> = [];
    for (const line of lines) {
      const embeddedIds = line.match(/\brss:[A-Za-z0-9_-]+\b/g);
      if (embeddedIds?.length) {
        tokens.push(...embeddedIds);
        continue;
      }
      const m = line.match(/^[-*\d.)\s]*(.+)$/);
      const token = (m?.[1] ?? line).trim();
      if (!token) continue;
      const numeric = Number(token);
      if (Number.isFinite(numeric) && token.match(/^\d+$/)) tokens.push(numeric);
      else tokens.push(token);
    }
    if (tokens.length > 0) return tokens;
    const idMatches = raw.match(/\brss:[A-Za-z0-9_-]+\b/g);
    return idMatches && idMatches.length > 0 ? idMatches : null;
  }
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

function getConfiguredModels(primaryModel: string): string[] {
  // Fallbacks are pinned in code (RANKING_FALLBACK_MODELS); we intentionally
  // ignore OPENROUTER_FALLBACK_MODELS / OPENROUTER_MAX_MODEL_ATTEMPTS so the env
  // can neither override the chain nor truncate it. Every model in the pinned
  // chain is tried in order.
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const model of [primaryModel, ...RANKING_FALLBACK_MODELS]) {
    if (seen.has(model)) continue;
    seen.add(model);
    unique.push(model);
  }
  return unique;
}

function getCacheKey(req: RankRequest, model: string): string {
  const ids = req.items.map((item) => item.id).join(",");
  const profileHint = req.userProfile?.topPublications
    ?.slice(0, 5)
    .map((p) => p.name)
    .join(",") ?? "none";
  return `${model}|${req.dayKey}|${req.cap}|${req.category}|${ids}|${profileHint}`;
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

function withMaxTokens(cap: number): number {
  const fallback = Math.min(1200, Math.max(400, cap * 12));
  const raw = Number(process.env.OPENROUTER_MAX_TOKENS ?? fallback);
  if (!Number.isFinite(raw) || raw < 128) return fallback;
  return Math.floor(raw);
}

export async function rankItemsForDailyCap(req: RankRequest): Promise<RankResult | null> {
  if (req.cap <= 0) return { ids: [], reasons: {} };
  if (req.items.length === 0) return { ids: [], reasons: {} };
  if (req.items.length <= req.cap) {
    const passthrough = req.items.map((item) => item.id);
    console.info(
      `[rss-ranker] skip ai call source="${req.sourceName}" day="${req.dayKey}" reason="candidates_within_cap" selected=${passthrough.length}`
    );
    return { ids: passthrough, reasons: {} };
  }

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

  // Primary + fallbacks are hard-pinned (see RANKING_MODEL / RANKING_FALLBACK_MODELS).
  const modelsToTry = getConfiguredModels(RANKING_MODEL);
  const cacheKey = getCacheKey(req, modelsToTry.join("|"));
  const cached = rankCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    console.info(
      `[rss-ranker] cache hit source="${req.sourceName}" day="${req.dayKey}" reason="${cached.reason}" cachedResult=${cached.value ? cached.value.ids.length : 0}`
    );
    return cached.value ? { ...cached.value } : null;
  }
  const inFlight = inFlightRankings.get(cacheKey);
  if (inFlight) {
    console.info(
      `[rss-ranker] join in-flight request source="${req.sourceName}" day="${req.dayKey}" cap=${req.cap}`
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
        `source=${item.sourceName?.trim() || req.sourceName}`,
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
    `source=${req.sourceName}
` +
    `category=${req.category}
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
    `Return exactly one line of JSON only: {"ids":["rss:...", ...],"reasons":{"rss:xxx":"<=8 words why"}}
` +
    `Rules: ids only, no indexes, no prose, unique ids, exactly ${Math.min(req.cap, req.items.length)} ids, every id must be from: ${validIds}. reasons is optional but encouraged.

` +
    `Candidates:
${candidates}`;

  const rankingPromise = (async (): Promise<RankResult | null> => {
    console.info(
      `[rss-ranker] ranking start source="${req.sourceName}" day="${req.dayKey}" cap=${req.cap} candidates=${req.items.length} models="${modelsToTry.join(",")}"`
    );
    const timeoutMs = withTimeoutMs();
    let data: OpenRouterResponse | null = null;

    for (let attemptIndex = 0; attemptIndex < modelsToTry.length; attemptIndex++) {
      const selectedModel = modelsToTry[attemptIndex];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            ...(process.env.OPENROUTER_SITE_URL ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL } : {}),
            ...(process.env.OPENROUTER_APP_NAME ? { "X-Title": process.env.OPENROUTER_APP_NAME } : {}),
          },
          body: JSON.stringify({
          model: selectedModel,
            temperature: 0.1,
            max_tokens: withMaxTokens(req.cap),
            messages: [
              {
                role: "system",
                content:
                  "You are a ranking engine. Output exactly one-line JSON matching the requested schema with no extra text.",
              },
              { role: "user", content: prompt },
            ],
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => "");
          const resetMs = response.status === 429 ? maybeExtractResetMs(errorBody) : null;
          if (resetMs) {
            providerCooldownUntilMs = resetMs;
          } else if (response.status === 429) {
            providerCooldownUntilMs = Date.now() + getFailureCooldownMs();
          }
          console.warn(
            `[rss-ranker] model attempt failed model="${selectedModel}" attempt=${attemptIndex + 1}/${modelsToTry.length} status=${response.status} statusText="${response.statusText}" body="${errorBody.slice(
              0,
              240
            )}"`
          );
          continue;
        }

        data = (await response.json()) as OpenRouterResponse;
        if (attemptIndex > 0) {
          console.info(`[rss-ranker] ranking succeeded using fallback model="${selectedModel}"`);
        }
        break;
      } catch (error) {
        console.warn(
          `[rss-ranker] model attempt threw model="${selectedModel}" attempt=${attemptIndex + 1}/${modelsToTry.length}`,
          error
        );
        continue;
      } finally {
        clearTimeout(timer);
      }
    }

    if (!data) {
      rankCache.set(cacheKey, {
        expiresAt: Date.now() + getFailureCooldownMs(),
        value: null,
        reason: "request_failed",
      });
      return null;
    }

    const content = contentToString(data.choices?.[0]?.message?.content);
    if (!content) {
      console.warn(
        `[rss-ranker] empty content returned modelResponsePreview="${JSON.stringify(data).slice(0, 400)}"`
      );
    }
    const parsedTokens = parseRankedTokens(content);
    if (!parsedTokens || parsedTokens.length === 0) {
      console.warn(
        `[rss-ranker] invalid/empty ranked ids returned contentPreview="${content.slice(0, 200)}"`
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
    const deduped: string[] = [];
    for (const token of parsedTokens) {
      const id = normalizeRankToken(token, byIndex);
      if (!id) continue;
      if (!allowed.has(id)) continue;
      if (deduped.includes(id)) continue;
      deduped.push(id);
    }
    if (deduped.length === 0) {
      console.warn(
        `[rss-ranker] ranked ids filtered out to empty set tokenPreview="${parsedTokens
          .slice(0, 8)
          .map((token) => String(token).slice(0, 80))
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

    // Extract per-item reasons if the LLM included them
    const parsedReasons: Record<string, string> = {};
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as { reasons?: unknown };
        if (parsed.reasons && typeof parsed.reasons === "object" && !Array.isArray(parsed.reasons)) {
          for (const [k, v] of Object.entries(parsed.reasons as Record<string, unknown>)) {
            if (typeof k === "string" && typeof v === "string") parsedReasons[k] = v;
          }
        }
      }
    } catch { /* reasons are best-effort; ignore parse errors */ }

    console.info(`[rss-ranker] ranking success selected=${limited.length}`);
    const rankResult: RankResult = { ids: limited, reasons: parsedReasons };
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
