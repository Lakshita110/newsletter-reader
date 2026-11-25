import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeUrl, syncRssSource } from "@/lib/rss";
import { parseOpml } from "@/lib/opml";
import { getSessionUserId } from "@/lib/session-user";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_FEEDS = 300;

/**
 * Bring over every feed from another reader in one go (Feedly, Reeder,
 * NetNewsWire all export OPML). Feeds are saved without checking each one
 * first, which would take minutes for a big list; one that fails shows a
 * failure badge in Settings after its first sync.
 */
export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const feeds = typeof body?.opml === "string" ? parseOpml(body.opml).slice(0, MAX_FEEDS) : [];
  if (feeds.length === 0) return NextResponse.json({ error: "No feeds found in that file" }, { status: 400 });

  const sourceIds: string[] = [];
  for (const feed of feeds) {
    const url = normalizeUrl(feed.xmlUrl);
    const source = await prisma.rssSource.upsert({
      where: { normalizedUrl: url },
      update: {},
      create: { name: feed.title, rssUrl: url, normalizedUrl: url },
      select: { id: true },
    });
    await prisma.userRssSubscription.upsert({
      where: { userId_rssSourceId: { userId, rssSourceId: source.id } },
      // A category in the file wins (e.g. "newsletter" keeps a feed out of the news ranking).
      update: { isActive: true, ...(feed.category ? { category: feed.category } : {}) },
      create: { userId, rssSourceId: source.id, category: feed.category ?? "other" },
    });
    sourceIds.push(source.id);
  }

  // Pull items now so the feed fills in right away; the cron covers any that
  // don't finish in time.
  const results = await Promise.allSettled(sourceIds.map((id) => syncRssSource(id)));
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) console.warn(`[sources/import] ${failed} of ${sourceIds.length} feeds failed their first sync`);

  return NextResponse.json({ ok: true, imported: sourceIds.length, failed });
}
