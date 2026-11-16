import { prisma } from "@/lib/prisma";
import { htmlToPlainText } from "@/lib/coverage";
import { openRouterChat, RANKING_MODEL_CHAIN } from "@/lib/openrouter";
import { WEB_ID_PREFIX } from "@/lib/saved-articles";

/** Enough for the gist of a long essay while keeping each call well under a cent. */
const MAX_INPUT_CHARS = 14000;

export class SummaryError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Plain text of any item the user can see, from whichever table holds it. */
async function getItemText(userId: string, itemId: string): Promise<{ title: string; text: string } | null> {
  if (itemId.startsWith(WEB_ID_PREFIX)) {
    const row = await prisma.savedArticle.findFirst({ where: { id: itemId.slice(WEB_ID_PREFIX.length), userId } });
    return row ? { title: row.title, text: row.text ?? htmlToPlainText(row.html ?? "") } : null;
  }
  if (itemId.startsWith("rss:")) {
    const row = await prisma.rssItem.findUnique({ where: { id: itemId.slice(4) }, include: { source: { include: { subscriptions: { where: { userId, isActive: true } } } } } });
    if (!row || row.source.subscriptions.length === 0) return null;
    return { title: row.title, text: row.textExtracted ?? htmlToPlainText(row.htmlRaw ?? row.snippet ?? "") };
  }
  const issue = await prisma.newsletterIssue.findUnique({ where: { userId_gmailMessageId: { userId, gmailMessageId: itemId } } });
  return issue ? { title: issue.subject, text: issue.text ?? htmlToPlainText(issue.html ?? "") } : null;
}

export function buildSummaryPrompt(title: string, text: string) {
  return [
    {
      role: "system" as const,
      content:
        "You summarize articles for a busy, technical reader. Reply in Markdown: 3-5 short bullets with the article's actual claims, numbers, and named examples (no filler like 'the author discusses'), then one line starting with '**Why it matters:**'. Do not add facts that are not in the article.",
    },
    { role: "user" as const, content: `Title: ${title}\n\n${text.slice(0, MAX_INPUT_CHARS)}` },
  ];
}

/**
 * Summary for one item: cached forever per user+item, generated on demand
 * only (when the reader taps Summarize) so spend tracks actual use.
 */
export async function getOrCreateSummary(userId: string, itemId: string) {
  const cached = await prisma.itemSummary.findUnique({ where: { userId_itemId: { userId, itemId } } });
  if (cached) return { summary: cached.summary, model: cached.model, cached: true };

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new SummaryError("Summaries need OPENROUTER_API_KEY to be set", 503);
  const item = await getItemText(userId, itemId);
  if (!item) throw new SummaryError("Item not found", 404);
  if (item.text.trim().split(/\s+/).length < 120) throw new SummaryError("Too short to summarize", 422);

  for (const model of RANKING_MODEL_CHAIN) {
    const result = await openRouterChat({
      apiKey,
      model,
      messages: buildSummaryPrompt(item.title, item.text),
      maxTokens: 400,
      timeoutMs: 20000,
      temperature: 0.2,
    });
    if (result.ok && result.content.trim()) {
      const summary = result.content.trim();
      await prisma.itemSummary.upsert({
        where: { userId_itemId: { userId, itemId } },
        update: {},
        create: { userId, itemId, summary, model },
      });
      return { summary, model, cached: false };
    }
    console.warn(`[summarize] ${model} failed`, result.ok ? "empty" : `${result.status} ${result.errorBody.slice(0, 200)}`);
  }
  throw new SummaryError("The summary service is unavailable right now", 502);
}
