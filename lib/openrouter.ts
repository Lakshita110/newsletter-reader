/**
 * Single OpenRouter chat-completions client. Every LLM feature (daily
 * ranking, read-profile summaries, feed suggestions) goes through this call
 * so auth headers, attribution, timeout handling, and response parsing exist
 * exactly once.
 */

// Model chains are pinned in code by design: env-based model selection was
// dropped so a misconfigured deployment can neither swap a chain nor
// truncate it. Models in a chain are tried in order until one succeeds.
//
// Two tiers, picked per task by how often it runs vs. how much judgment it
// needs:
// - FAST: cheap and quick. For high-volume or mechanical work (short
//   summaries) where a small model is good enough.
// - SMART: a strong model first. For low-volume calls whose output the whole
//   day hangs on: choosing what's worth reading, profiling taste, suggesting
//   sources, condensing long deep dives. These run a handful of times a day,
//   so the stronger model costs a few dollars a month, not per call.
// SMART ends with the FAST chain so an outage or a retired model id degrades
// to the old behaviour instead of to "no ranking at all".
export const FAST_MODEL_CHAIN = ["openai/gpt-4o-mini", "google/gemini-2.0-flash-001"];
export const SMART_MODEL_CHAIN = ["anthropic/claude-sonnet-4.5", "openai/gpt-4.1", ...FAST_MODEL_CHAIN];
export const RANKING_MODEL_CHAIN = SMART_MODEL_CHAIN;

/** Short, human name for a model id, for "Picked by …" labels in the UI. */
export function modelLabel(model: string | null | undefined): string | null {
  if (!model) return null;
  const known: Record<string, string> = {
    "anthropic/claude-sonnet-4.5": "Claude Sonnet",
    "openai/gpt-4.1": "GPT-4.1",
    "openai/gpt-4o-mini": "GPT-4o mini",
    "google/gemini-2.0-flash-001": "Gemini Flash",
  };
  return known[model] ?? model.split("/").pop() ?? model;
}

type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenRouterResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

export type OpenRouterChatResult =
  | { ok: true; content: string; finishReason?: string }
  | {
      ok: false;
      /** HTTP status of the failed response, or null when the request threw (timeout, network). */
      status: number | null;
      errorBody: string;
    };

/** OpenRouter may return message content as a string or as typed text parts. */
export function contentToString(
  content: string | Array<{ type?: string; text?: string }> | undefined
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
}

export async function openRouterChat(args: {
  apiKey: string;
  model: string;
  messages: OpenRouterMessage[];
  maxTokens: number;
  timeoutMs: number;
  temperature?: number;
}): Promise<OpenRouterChatResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
        ...(process.env.OPENROUTER_SITE_URL ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL } : {}),
        ...(process.env.OPENROUTER_APP_NAME ? { "X-Title": process.env.OPENROUTER_APP_NAME } : {}),
      },
      body: JSON.stringify({
        model: args.model,
        temperature: args.temperature ?? 0.1,
        max_tokens: args.maxTokens,
        messages: args.messages,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      return { ok: false, status: response.status, errorBody };
    }
    const data = (await response.json()) as OpenRouterResponse;
    const choice = data.choices?.[0];
    return {
      ok: true,
      content: contentToString(choice?.message?.content),
      finishReason: choice?.finish_reason,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      errorBody: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Try each model in `models` until one returns non-empty content. Every
 * failed attempt is logged with its status so a retired model id or a missing
 * credit balance shows up in the Vercel logs instead of silently degrading.
 */
export async function openRouterChatWithFallback(args: {
  apiKey: string;
  models: string[];
  messages: OpenRouterMessage[];
  maxTokens: number;
  timeoutMs: number;
  temperature?: number;
  logTag: string;
}): Promise<{ ok: true; content: string; model: string; finishReason?: string } | { ok: false; lastStatus: number | null }> {
  let lastStatus: number | null = null;
  for (const model of args.models) {
    const result = await openRouterChat({ ...args, model });
    if (result.ok && result.content.trim()) {
      return { ok: true, content: result.content, model, finishReason: result.finishReason };
    }
    lastStatus = result.ok ? 200 : result.status;
    console.warn(
      `[${args.logTag}] model="${model}" failed: ${result.ok ? "empty content" : `status=${result.status ?? "thrown"} body="${result.errorBody.slice(0, 200)}"`}`
    );
  }
  return { ok: false, lastStatus };
}
