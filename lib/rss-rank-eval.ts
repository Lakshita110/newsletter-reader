import { prisma } from "@/lib/prisma";

type EvalItem = {
  id: string;
  title: string;
  sourceName: string;
  snippet?: string | null;
};

export type RankEvalInput = {
  userId: string;
  dayKey: string;
  selectedItems: EvalItem[];
  candidateItems: EvalItem[];
  userProfileSummary: string;
  cap: number;
  source?: "CRON" | "ON_DEMAND";
};

export type RankEvalResult = {
  overallScore: number;
  diversityScore: number;
  qualityScore: number;
  issues: string[];
  suggestions: string[];
};

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

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

function clampScore(value: unknown): number {
  return Math.min(10, Math.max(0, Number(value) || 0));
}

export async function runAndPersistRankEval(
  input: RankEvalInput
): Promise<RankEvalResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const model =
    process.env.OPENROUTER_EVAL_MODEL ??
    process.env.OPENROUTER_MODEL ??
    "gpt-4o-mini";

  const selectedSet = new Set(input.selectedItems.map((i) => i.id));
  const notSelected = input.candidateItems
    .filter((i) => !selectedSet.has(i.id))
    .slice(0, 10);

  const formatItems = (items: EvalItem[]) =>
    items.map((item) => `- ${item.title} [${item.sourceName}]`).join("\n");

  const prompt = `You are evaluating an RSS feed ranking result. Score the selection on three axes (0-10 each):
- overall: how well the selection serves this user overall
- diversity: source and topic variety (penalize 3+ from same source)
- quality: relevance and signal-to-noise for this user

User profile: ${input.userProfileSummary}
Daily cap: ${input.cap}

SELECTED (${input.selectedItems.length} items):
${formatItems(input.selectedItems)}

NOT SELECTED (sample):
${formatItems(notSelected)}

Return JSON only on one line:
{"overallScore":N,"diversityScore":N,"qualityScore":N,"issues":["..."],"suggestions":["..."]}
Rules: scores 0-10, issues list specific problems, suggestions list actionable improvements to the ranking prompt, no prose outside JSON.`;

  const timeoutMs = Math.min(
    60000,
    Number(process.env.OPENROUTER_TIMEOUT_MS ?? 60000)
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let raw: string;
  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(process.env.OPENROUTER_SITE_URL
            ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL }
            : {}),
          ...(process.env.OPENROUTER_APP_NAME
            ? { "X-Title": process.env.OPENROUTER_APP_NAME }
            : {}),
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 512,
          messages: [
            {
              role: "system",
              content:
                "You are a ranking evaluator. Return only the requested JSON, one line, no markdown.",
            },
            { role: "user", content: prompt },
          ],
        }),
        signal: controller.signal,
      }
    );
    if (!response.ok) {
      throw new Error(`OpenRouter eval request failed: ${response.status}`);
    }
    const data = (await response.json()) as OpenRouterResponse;
    raw = contentToString(data.choices?.[0]?.message?.content);
  } finally {
    clearTimeout(timer);
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Eval LLM returned no JSON: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(jsonMatch[0]) as Partial<RankEvalResult>;

  const result: RankEvalResult = {
    overallScore: clampScore(parsed.overallScore),
    diversityScore: clampScore(parsed.diversityScore),
    qualityScore: clampScore(parsed.qualityScore),
    issues: Array.isArray(parsed.issues)
      ? parsed.issues.filter((s): s is string => typeof s === "string")
      : [],
    suggestions: Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((s): s is string => typeof s === "string")
      : [],
  };

  await prisma.rssRankEvalLog.create({
    data: {
      userId: input.userId,
      dayKey: input.dayKey,
      overallScore: result.overallScore,
      diversityScore: result.diversityScore,
      qualityScore: result.qualityScore,
      issues: result.issues,
      suggestions: result.suggestions,
      model,
      source: input.source ?? null,
    },
  });

  return result;
}
