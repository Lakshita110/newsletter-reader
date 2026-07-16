/**
 * Single OpenRouter chat-completions client. Every LLM feature (daily
 * ranking, read-profile summaries, feed suggestions) goes through this call
 * so auth headers, attribution, timeout handling, and response parsing exist
 * exactly once.
 */

// The model chain is pinned in code by design: env-based model selection was
// dropped so a misconfigured deployment can neither swap the chain nor
// truncate it. Models are tried in order until one succeeds.
export const RANKING_MODEL = "openai/gpt-4o-mini";
export const RANKING_MODEL_CHAIN = [RANKING_MODEL, "google/gemini-2.0-flash-001"];

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
