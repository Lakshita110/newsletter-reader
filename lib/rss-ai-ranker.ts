import { SMART_MODEL_CHAIN, openRouterChat } from "@/lib/openrouter";
import type { ReadingSignals } from "@/lib/reading-signals";

type RankItemInput = {
  id: string;
  /** Other sources running the same story today (lib/story-buzz.ts). */
  coverage?: number;
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
  /** Her last two weeks of opens and unopened swipes (lib/reading-signals). */
  signals?: ReadingSignals;
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

// Tuned to her: she reads FT/WSJ/NYT/Economist for the day's news and
// Stratechery/Pragmatic Engineer for tech. The old default ("include culture
// coverage, avoid politics") filled the top with oddities while the day's
// market sell-off and NATO news sat lower down.
const DEFAULT_INTEREST_PROMPT =
  "Lead with the day's most important news, the way a front page would: markets and the economy, geopolitics and wars, major policy, and big moves in tech and AI. Then strong analysis on tech, AI, startups and business. Lifestyle, culture and quirky features only if exceptional.";

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
    /\{\s*"id"\s*:\s*(?:"([A-Za-z0-9:_-]*[A-Za-z_:-][A-Za-z0-9:_-]*)"|(\d+))\s*,\s*"reason"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
  const reasonFirst =
    /\{\s*"reason"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"id"\s*:\s*(?:"([A-Za-z0-9:_-]*[A-Za-z_:-][A-Za-z0-9:_-]*)"|(\d+))\s*\}/g;
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

function normalizeRankToken(token: string | number, byIndex: Map<number, string>): string | undefined {
  // The model is asked for ids but sometimes echoes a list position instead.
  // The prompt numbers candidates from 1; the n+1 lookup also tolerates a
  // model that counted from 0.
  const fromPosition = (n: number) => byIndex.get(n) ?? byIndex.get(n + 1);

  if (typeof token === "number") return fromPosition(Math.floor(token));

  const trimmed = token.trim();
  // Models sometimes wrap the id ("id=rss:abc", "rss:abc (Stratechery)").
  const embeddedId = trimmed.match(/\brss:[A-Za-z0-9_-]+\b/)?.[0];
  if (embeddedId) return embeddedId;
  if (/^\d+$/.test(trimmed)) return fromPosition(Number(trimmed));

  return trimmed;
}

function getCacheKey(req: RankRequest, model: string): string {
  const ids = req.items.map((item) => item.id).join(",");
  const profileHint =
    req.userProfile?.topPublications
      ?.slice(0, 5)
      .map((p) => p.name)
      .join(",") ?? "none";
  // A new read or skip should get a fresh ranking, not a cached one.
  const signalHint = req.signals ? `${req.signals.recentReads[0] ?? ""}|${req.signals.recentSkips[0] ?? ""}` : "";
  return `${model}|${req.dayKey}|${req.cap}|${ids}|${profileHint}|${signalHint}`;
}

/** Read a millisecond env override, ignoring unset/unparseable/sub-second values. */
function envMs(name: string, fallbackMs: number): number {
  const ms = Number(process.env[name] ?? fallbackMs);
  if (!Number.isFinite(ms) || ms < 1000) return fallbackMs;
  return ms;
}

function getCacheTtlMs(): number {
  return envMs("OPENROUTER_RANK_CACHE_TTL_MS", 10 * 60 * 1000);
}

function getFailureCooldownMs(): number {
  return envMs("OPENROUTER_FAILURE_COOLDOWN_MS", 60 * 1000);
}

function getTimeoutMs(): number {
  return envMs("OPENROUTER_TIMEOUT_MS", 300_000);
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

export function withMaxTokens(cap: number): number {
  // Each pick is one {"id":"rss:x","reason":"..."} object: an id (~10 tokens),
  // a short reason (<=10 words, ~16 tokens), plus the object's own
  // braces/keys/quoting (~14 tokens) — call it ~40 tokens/item, plus envelope
  // headroom. Even if this runs low and truncation still happens, atomic picks
  // mean a cut tail just drops whole trailing items rather than splitting an
  // id from its reason.
  return Math.min(4096, Math.max(512, 256 + cap * 40));
}

/**
 * What she did with recent picks, as prompt text. Opens are the strongest
 * "more like this" we have; a swipe away without opening is a "not for me".
 * Exported for tests.
 */
export function signalsSection(signals: ReadingSignals | undefined): string {
  if (!signals) return "";
  const lines: string[] = [];
  if (signals.recentReads.length > 0) {
    lines.push("Recently opened (more like these):", ...signals.recentReads.map((r) => `- ${r}`));
  }
  if (signals.recentSkips.length > 0) {
    lines.push(
      "Recently dismissed without opening (fewer like these; a major story still belongs in the feed):",
      ...signals.recentSkips.map((r) => `- ${r}`)
    );
  }
  if (signals.oftenSkippedSources.length > 0) {
    const list = signals.oftenSkippedSources.map((s) => `${s.name}(${s.skipped} skipped/${s.read} opened)`).join(", ");
    lines.push(`Sources she mostly skips: ${list}`);
  }
  if (lines.length === 0) return "";
  return `What she did with recent items (last two weeks):\n${lines.join("\n")}\n`;
}

export async function rankItemsForDailyCap(req: RankRequest): Promise<RankResult | null> {
  if (req.cap <= 0 || req.items.length === 0) return { ids: [], reasons: {}, model: null };

  // Note: even when the candidates already fit within the cap we still call
  // the ranker, because the reasons it returns are what the UI's "why?" pills
  // render — skipping the call leaves small-pool days with no reasons at all.

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

  const cacheKey = getCacheKey(req, SMART_MODEL_CHAIN.join("|"));
  const cached = rankCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    console.info(
      `[rss-ranker] cache hit day="${req.dayKey}" reason="${cached.reason}" cachedResult=${cached.value ? cached.value.ids.length : 0}`
    );
    return cached.value ? { ...cached.value } : null;
  }
  const inFlight = inFlightRankings.get(cacheKey);
  if (inFlight) {
    console.info(`[rss-ranker] join in-flight request day="${req.dayKey}" cap=${req.cap}`);
    const shared = await inFlight;
    return shared ? { ...shared } : null;
  }

  const candidates = req.items
    .map((item, index) => {
      const snippetLine = item.snippet?.trim() ? `snippet=${item.snippet.trim().slice(0, 280)}` : null;
      const dateLine = item.publishedAtIso ? `published=${item.publishedAtIso.slice(0, 10)}` : null;
      return [
        `${index + 1}. id=${item.id}`,
        `coverage=${item.coverage ?? 0}`,
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

  const topPubsLine = req.userProfile?.topPublications?.length
    ? req.userProfile.topPublications
        .slice(0, 8)
        .map((p) => `${p.name}(${p.score.toFixed(1)})`)
        .join(", ")
    : "none";
  const profileNotes = req.userProfile?.preferenceSummary?.length
    ? req.userProfile.preferenceSummary.map((x) => `- ${x}`).join("\n")
    : "- no strong preference signals yet";

  const customInterestPrompt = req.userProfile?.customPrompt?.trim();
  const interestGuidance = customInterestPrompt
    ? `User-stated interests: ${customInterestPrompt}`
    : DEFAULT_INTEREST_PROMPT;
  const uniqueSourceCount = new Set(
    req.items.map((item) => item.sourceName?.trim().toLowerCase()).filter((value): value is string => Boolean(value))
  ).size;
  const targetUniqueSources = Math.min(uniqueSourceCount, Math.max(1, Math.min(req.cap, 8)));
  const pickCount = Math.min(req.cap, req.items.length);

  const prompt = `Pick the best ${pickCount} items for this user's reading feed and order them best-to-worst.

Context:
day=${req.dayKey}

User profile:
top_publications=${topPubsLine}
avg_completion_pct=${req.userProfile?.avgCompletionPct ?? 0}
recent_reads_7d=${req.userProfile?.recentReadCount7d ?? 0}
${profileNotes}

${signalsSection(req.signals)}
Interest guidance:
${interestGuidance}

Big news:
coverage=N means N of her other sources are running the same story today. A high count marks the day's major news (a market sell-off, a war or alliance development, a major policy move). The most widely covered stories belong near the top even when their headlines look routine. Pick only the single best version of each story; never pick two items about the same event.

Diversity guidance:
Favor a varied set of publishers. Avoid selecting 3 or more items from the same publisher, and avoid publisher-heavy blocks such as multiple New Yorker stories in a row. Importance beats variety: a major story is never dropped just to add another publisher.

Source coverage:
Aim for at least ${targetUniqueSources} distinct sources when possible, while still prioritizing overall relevance.

Quality guidance:
Prefer original reporting and analysis over rewrites of press releases, listicles, and pieces whose snippet promises nothing specific. A reason must name what the reader gets from this particular piece (e.g. "inside look at TSMC's Arizona yields"), never a generic label like "relevant tech news".

Return exactly one line of JSON only: {"picks":[{"id":"<id>","reason":"<=10 words why"}, ...]}
Rules: order best-to-worst, exactly ${pickCount} picks, unique ids, every id must be from: ${validIds}. Every pick object must have both "id" and "reason" — never emit an id without its reason.

Candidates:
${candidates}`;

  const rankingPromise = (async (): Promise<RankResult | null> => {
    console.info(
      `[rss-ranker] ranking start day="${req.dayKey}" cap=${req.cap} candidates=${req.items.length} models="${SMART_MODEL_CHAIN.join(",")}"`
    );
    const timeoutMs = getTimeoutMs();
    let content: string | null = null;
    let finishReason: string | undefined;
    let usedModel: string | null = null;

    for (let attemptIndex = 0; attemptIndex < SMART_MODEL_CHAIN.length; attemptIndex++) {
      const selectedModel = SMART_MODEL_CHAIN[attemptIndex];
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
          `[rss-ranker] model attempt failed model="${selectedModel}" attempt=${attemptIndex + 1}/${SMART_MODEL_CHAIN.length} status=${result.status ?? "thrown"} body="${result.errorBody.slice(0, 240)}"`
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
      console.warn(`[rss-ranker] invalid/empty picks returned contentPreview="${content.slice(0, 200)}"`);
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
    // Every entry in `resolved` came from one atomic {id, reason} pick, so ids
    // and reasons stay paired by construction — no separate recovery pass
    // that could salvage a different count of each.
    const resolved: Array<{ id: string; reason: string }> = [];
    const seenIds = new Set<string>();
    for (const pick of picks) {
      const id = normalizeRankToken(pick.rawId, byIndex);
      if (!id || !allowed.has(id) || seenIds.has(id)) continue;
      seenIds.add(id);
      resolved.push({ id, reason: pick.reason });
    }
    if (resolved.length === 0) {
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
    const limited = resolved.slice(0, req.cap);
    const ids = limited.map((pick) => pick.id);
    const reasons: Record<string, string> = {};
    for (const pick of limited) reasons[pick.id] = pick.reason;

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
