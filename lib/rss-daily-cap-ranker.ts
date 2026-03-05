type RankItemInput = {
  id: string;
  title: string;
  snippet?: string | null;
  author?: string | null;
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
  };
};

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

type RankCacheEntry = {
  expiresAt: number;
  value: string[] | null;
  reason: string;
};

const rankCache = new Map<string, RankCacheEntry>();
const inFlightRankings = new Map<string, Promise<string[] | null>>();
let providerCooldownUntilMs = 0;

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
    };
    const pick = parsed.ids ?? parsed.indexes ?? parsed.indices ?? parsed.selected;
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
      const m = line.match(/^[-*\d.)\s]*(.+)$/);
      const token = (m?.[1] ?? line).trim();
      if (!token) continue;
      const numeric = Number(token);
      if (Number.isFinite(numeric) && token.match(/^\d+$/)) tokens.push(numeric);
      else tokens.push(token);
    }
    return tokens.length > 0 ? tokens : null;
  }
}

function getConfiguredModels(primaryModel: string): string[] {
  const fallbacks = (process.env.OPENROUTER_FALLBACK_MODELS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const model of [primaryModel, ...fallbacks]) {
    if (seen.has(model)) continue;
    seen.add(model);
    unique.push(model);
  }
  const maxAttempts = Math.max(
    1,
    Math.min(5, Number(process.env.OPENROUTER_MAX_MODEL_ATTEMPTS ?? 2) || 2)
  );
  return unique.slice(0, maxAttempts);
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
  const ms = Number(process.env.OPENROUTER_TIMEOUT_MS ?? 15000);
  if (!Number.isFinite(ms) || ms < 1000) return 15000;
  return ms;
}

export async function rankItemsForDailyCap(req: RankRequest): Promise<string[] | null> {
  if (req.cap <= 0) return [];
  if (req.items.length === 0) return [];
  if (req.items.length <= req.cap) {
    const passthrough = req.items.map((item) => item.id);
    console.info(
      `[rss-ranker] skip ai call source="${req.sourceName}" day="${req.dayKey}" reason="candidates_within_cap" selected=${passthrough.length}`
    );
    return passthrough;
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

  const model = process.env.OPENROUTER_MODEL ?? "openrouter/free";
  const modelsToTry = getConfiguredModels(model);
  const cacheKey = getCacheKey(req, modelsToTry.join("|"));
  const cached = rankCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    console.info(
      `[rss-ranker] cache hit source="${req.sourceName}" day="${req.dayKey}" reason="${cached.reason}" cachedResult=${cached.value ? cached.value.length : 0}`
    );
    return cached.value ? [...cached.value] : null;
  }
  const inFlight = inFlightRankings.get(cacheKey);
  if (inFlight) {
    console.info(
      `[rss-ranker] join in-flight request source="${req.sourceName}" day="${req.dayKey}" cap=${req.cap}`
    );
    const shared = await inFlight;
    return shared ? [...shared] : null;
  }

  const candidates = req.items
    .map(
      (item, index) =>
        `${index + 1}. index=${index + 1}\n` +
        `id=${item.id}\n` +
        `title=${item.title}\n` +
        `author=${item.author ?? "unknown"}\n` +
        `published_at=${item.publishedAtIso}\n` +
        `snippet=${item.snippet ?? ""}`
    )
    .join("\n\n");

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

  const prompt =
    `Task: choose which articles should appear in today's capped RSS inbox.\n\n` +
    `Selection target:\n` +
    `- Choose 20-30 items whenever candidate volume allows.\n` +
    `- Never exceed ${req.cap} items.\n` +
    `- If ${req.cap} is within 20-30, select exactly ${req.cap}.\n` +
    `- If ${req.cap} is outside 20-30, select min(${req.cap}, candidate_count) while staying as close to 20-30 as possible.\n` +
    `- Order selections from best to worst.\n\n` +
    `Context:\n` +
    `- source: ${req.sourceName}\n` +
    `- category: ${req.category}\n` +
    `- day: ${req.dayKey}\n\n` +
    `User read-history profile (use this heavily):\n` +
    `- top_publications: ${topPubsLine}\n` +
    `- avg_completion_pct: ${req.userProfile?.avgCompletionPct ?? 0}\n` +
    `- recent_reads_7d: ${req.userProfile?.recentReadCount7d ?? 0}\n` +
    `${profileNotes}\n\n` +
    `Ranking policy:\n` +
    `1) Personal relevance: prioritize topics and angles likely to match what this user actually finishes.\n` +
    `2) Quality signal: favor concrete, high-information pieces over shallow rewrites/clickbait.\n` +
    `3) Novelty: avoid selecting near-duplicate headlines on the same event unless materially distinct.\n` +
    `4) Diversity: keep a useful spread of subtopics when quality is similar.\n` +
    `5) Timeliness: break ties toward more recent publication time.\n\n` +
    `Editorial balance constraints (apply when candidates exist):\n` +
    `- Do not make the list politics-only.\n` +
    `- Include culture coverage: pick at least 1 culture/arts/society item, and prefer 2 when cap >= 8.\n` +
    `- Include top tech coverage: pick at least 1 strong tech/AI/product/security/business-of-tech item.\n` +
    `- Include depth: pick 1-2 long-form or high-depth pieces (analysis, feature, investigation, interview, deep explainer).\n` +
    `- If a constraint cannot be satisfied from candidates, choose the closest available non-duplicate alternative.\n\n` +
    `Output format rules (strict):\n` +
    `- Return JSON only.\n` +
    `- Use exactly this schema: {"ids":[<index_or_id>, <index_or_id>, ...]}\n` +
    `- Each element can be either the candidate index number (preferred) or exact id string.\n` +
    `- Values must come from candidate list only.\n` +
    `- Do not include explanations.\n\n` +
    `Candidates:\n${candidates}`;

  const rankingPromise = (async (): Promise<string[] | null> => {
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
            messages: [{ role: "user", content: prompt }],
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
      let id: string | undefined;
      if (typeof token === "number") {
        id = byIndex.get(Math.floor(token));
      } else if (typeof token === "string") {
        const numeric = Number(token);
        if (Number.isFinite(numeric) && token.match(/^\d+$/)) {
          id = byIndex.get(Math.floor(numeric));
        } else {
          id = token.trim();
        }
      }
      if (!id) continue;
      if (!allowed.has(id)) continue;
      if (deduped.includes(id)) continue;
      deduped.push(id);
    }
    if (deduped.length === 0) {
      console.warn("[rss-ranker] ranked ids filtered out to empty set");
      rankCache.set(cacheKey, {
        expiresAt: Date.now() + getFailureCooldownMs(),
        value: null,
        reason: "filtered_empty",
      });
      return null;
    }
    const limited = deduped.slice(0, req.cap);
    console.info(`[rss-ranker] ranking success selected=${limited.length}`);
    rankCache.set(cacheKey, {
      expiresAt: Date.now() + getCacheTtlMs(),
      value: [...limited],
      reason: "success",
    });
    return limited;
  })();

  inFlightRankings.set(cacheKey, rankingPromise);
  try {
    const result = await rankingPromise;
    return result ? [...result] : null;
  } finally {
    inFlightRankings.delete(cacheKey);
  }
}
