import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchFeedTitle, normalizeUrl, syncRssSource } from "@/lib/rss";
import { resolveFeedUrl } from "@/lib/feed-url";
import { discoverFeedCandidates } from "@/lib/feed-discovery";
import { parseRssCategoryInput } from "@/lib/rss-categories";
import { getSessionUserId } from "@/lib/session-user";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const subscriptions = await prisma.userRssSubscription.findMany({
    where: { userId, isActive: true },
    include: { source: true },
    orderBy: [{ updatedAt: "desc" }],
  });

  return NextResponse.json(
    subscriptions.map((sub) => ({
      id: sub.id,
      sourceId: sub.source.id,
      name: sub.source.name,
      rssUrl: sub.source.rssUrl,
      siteUrl: sub.source.siteUrl,
      isActive: sub.isActive,
      category: parseRssCategoryInput(sub.category).value ?? "other",
      lastSyncedAt: sub.source.lastSyncedAt,
      consecutiveFailures: sub.source.consecutiveFailures,
      lastErrorAt: sub.source.lastErrorAt,
      lastErrorMessage: sub.source.lastErrorMessage,
    }))
  );
}

/** Max candidate URLs tried per add, so a site with no feed fails in seconds. */
const MAX_FEED_ATTEMPTS = 5;

async function findWorkingFeed(url: string): Promise<{ url: string; title: string } | null> {
  try {
    return { url, title: await fetchFeedTitle(url) };
  } catch {
    // Not a feed itself; maybe a website that has one.
  }
  const candidates = await discoverFeedCandidates(url, fetchPageHtml);
  for (const candidate of candidates.slice(0, MAX_FEED_ATTEMPTS)) {
    try {
      const feedUrl = normalizeUrl(candidate);
      return { url: feedUrl, title: await fetchFeedTitle(feedUrl) };
    } catch {
      // Try the next candidate.
    }
  }
  console.warn("[sources/rss] no working feed found", url);
  return null;
}

async function fetchPageHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { Accept: "text/html" } });
    return res.ok ? await res.text() : null;
  } catch (err) {
    console.warn("[sources/rss] page fetch failed", url, err);
    return null;
  }
}

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  // Accept a Substack handle, homepage or post link as well as a real feed URL.
  const rssUrl = resolveFeedUrl(typeof body?.rssUrl === "string" ? body.rssUrl : "");
  const siteUrl = typeof body?.siteUrl === "string" ? body.siteUrl.trim() : "";
  const parsedCategory = parseRssCategoryInput(body?.category);
  if (parsedCategory.isInvalid) {
    return NextResponse.json({ error: "Invalid category option" }, { status: 400 });
  }
  // Category only matters for filtering in Sources; one ranked feed doesn't need it.
  const category = parsedCategory.value ?? "other";
  const normalized = normalizeUrl(rssUrl);
  if (!normalized) {
    return NextResponse.json({ error: "Missing rssUrl" }, { status: 400 });
  }

  // Find a feed that actually parses before saving: a typo should fail here
  // with a clear message, not turn into a silently failing source. If what
  // she pasted is a website rather than a feed, look for the site's feed.
  // The feed's title supplies the name when none was typed.
  let name = typeof body?.name === "string" ? body.name.trim() : "";
  const found = await findWorkingFeed(normalized);
  if (!found) {
    return NextResponse.json({ error: `Couldn't find a feed at ${normalized}` }, { status: 400 });
  }
  const feedUrl = found.url;
  if (!name) name = found.title;

  const source = await prisma.rssSource.upsert({
    where: { normalizedUrl: feedUrl },
    update: {
      name,
      siteUrl: siteUrl || undefined,
      rssUrl: feedUrl,
    },
    create: {
      name,
      rssUrl: feedUrl,
      normalizedUrl: feedUrl,
      siteUrl: siteUrl || null,
    },
  });

  const subscription = await prisma.userRssSubscription.upsert({
    where: { userId_rssSourceId: { userId, rssSourceId: source.id } },
    update: { isActive: true, category },
    create: { userId, rssSourceId: source.id, category },
  });

  // Pull its items now so the new source shows up in Today without waiting for the cron.
  await syncRssSource(source.id).catch((err) => console.error("[sources/rss] initial sync failed", source.id, err));

  return NextResponse.json({
    ok: true,
    name,
    subscriptionId: subscription.id,
    sourceId: source.id,
  });
}
