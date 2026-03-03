import crypto from "crypto";
import Parser from "rss-parser";
import { prisma } from "@/lib/prisma";

const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
      ["dc:creator", "dcCreator", { keepArray: true }],
    ],
  },
});

export function normalizeUrl(input: string): string {
  try {
    const url = new URL(input.trim());
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return input.trim();
  }
}

function deriveExternalId(item: { guid?: string; link?: string; title?: string; isoDate?: string; pubDate?: string }) {
  if (item.guid?.trim()) return item.guid.trim();
  if (item.link?.trim()) return normalizeUrl(item.link.trim());
  const fallback = `${item.title ?? ""}|${item.isoDate ?? item.pubDate ?? ""}`;
  return crypto.createHash("sha256").update(fallback).digest("hex");
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function extractRssImageUrl(item: Record<string, unknown>, html?: string | null): string | undefined {
  const enclosure = item.enclosure as { url?: string } | undefined;
  const enclosureUrl = firstString(enclosure?.url);
  if (enclosureUrl) return enclosureUrl;

  const mediaContent = (item.mediaContent ?? item["media:content"]) as
    | { $?: { url?: string }; url?: string }
    | Array<{ $?: { url?: string }; url?: string }>
    | undefined;
  if (Array.isArray(mediaContent)) {
    for (const entry of mediaContent) {
      const url = firstString(entry?.$?.url) ?? firstString(entry?.url);
      if (url) return url;
    }
  } else if (mediaContent) {
    const url = firstString(mediaContent?.$?.url) ?? firstString(mediaContent?.url);
    if (url) return url;
  }

  const mediaThumb = (item.mediaThumbnail ?? item["media:thumbnail"]) as
    | { $?: { url?: string }; url?: string }
    | Array<{ $?: { url?: string }; url?: string }>
    | undefined;
  if (Array.isArray(mediaThumb)) {
    for (const entry of mediaThumb) {
      const url = firstString(entry?.$?.url) ?? firstString(entry?.url);
      if (url) return url;
    }
  } else if (mediaThumb) {
    const url = firstString(mediaThumb?.$?.url) ?? firstString(mediaThumb?.url);
    if (url) return url;
  }

  const htmlText = (html ?? "").toString();
  const og = htmlText.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) return og[1];
  const img = htmlText.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (img?.[1]) return img[1];

  return undefined;
}

export async function syncRssSource(rssSourceId: string) {
  const source = await prisma.rssSource.findUnique({ where: { id: rssSourceId } });
  if (!source || !source.isActive) return { inserted: 0, updated: 0 };

  const feed = await parser.parseURL(source.rssUrl);
  const items = feed.items ?? [];
  if (items.length === 0) {
    await prisma.rssSource.update({
      where: { id: source.id },
      data: { lastSyncedAt: new Date() },
    });
    return { inserted: 0, updated: 0 };
  }

  const externalIds = items.map((item) => deriveExternalId(item));
  const existing = await prisma.rssItem.findMany({
    where: {
      rssSourceId: source.id,
      externalId: { in: externalIds },
    },
    select: { externalId: true },
  });
  const existingSet = new Set(existing.map((row) => row.externalId));

  const createRows: Array<{
    rssSourceId: string;
    externalId: string;
    title: string;
    author: string | null;
    link: string | null;
    imageUrl: string | null;
    publishedAt: Date | null;
    snippet: string | null;
    htmlRaw: string | null;
    textExtracted: string | null;
  }> = [];
  let inserted = 0;
  let updated = 0;

  for (const item of items) {
    const anyItem = item as unknown as Record<string, unknown> & {
      author?: string;
      creator?: string;
      dcCreator?: string[];
      mediaContent?: unknown;
      mediaThumbnail?: unknown;
    };
    const externalId = deriveExternalId(item);
    const html =
      typeof anyItem["content:encoded"] === "string"
        ? (anyItem["content:encoded"] as string)
        : typeof item.content === "string"
        ? item.content
        : undefined;
    const imageUrl = extractRssImageUrl(anyItem, html || null);
    const snippet = (item.contentSnippet ?? item.content ?? "").toString().slice(0, 500).trim();
    const publishedAt = item.isoDate
      ? new Date(item.isoDate)
      : item.pubDate
      ? new Date(item.pubDate)
      : null;

    if (existingSet.has(externalId)) {
      updated += 1;
      continue;
    }

    createRows.push({
      rssSourceId: source.id,
      externalId,
      title: item.title?.trim() || "(Untitled)",
      author:
        (Array.isArray(anyItem.dcCreator)
          ? anyItem.dcCreator?.find((x) => typeof x === "string")
          : undefined) ??
        item.creator ??
        anyItem.author ??
        null,
      link: item.link?.trim() || null,
      imageUrl: imageUrl || null,
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
      snippet: snippet || null,
      // Keep RSS storage lightweight; full article content is fetched on demand in reader view.
      htmlRaw: null,
      textExtracted: null,
    });
    inserted += 1;
  }

  if (createRows.length > 0) {
    await prisma.rssItem.createMany({
      data: createRows,
      skipDuplicates: true,
    });
  }

  await prisma.rssSource.update({
    where: { id: source.id },
    data: { lastSyncedAt: new Date() },
  });

  return { inserted, updated };
}

