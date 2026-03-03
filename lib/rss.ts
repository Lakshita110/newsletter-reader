import crypto from "crypto";
import Parser from "rss-parser";
import { prisma } from "@/lib/prisma";
import { extractArticleContent } from "@/lib/article-extract";

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
  let inserted = 0;
  let updated = 0;

  for (const item of feed.items ?? []) {
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
    const extracted = html ? await extractArticleContent(html, item.link ?? undefined) : null;
    const textExtracted = extracted?.text || (item.contentSnippet ?? "").trim();
    const htmlExtracted = extracted?.html || html || null;
    const imageUrl = extractRssImageUrl(anyItem, htmlExtracted || html);
    const snippet = (item.contentSnippet ?? item.content ?? "").toString().slice(0, 500).trim();
    const publishedAt = item.isoDate
      ? new Date(item.isoDate)
      : item.pubDate
      ? new Date(item.pubDate)
      : null;

    const existing = await prisma.rssItem.findUnique({
      where: { rssSourceId_externalId: { rssSourceId: source.id, externalId } },
      select: { id: true },
    });

    await prisma.rssItem.upsert({
      where: { rssSourceId_externalId: { rssSourceId: source.id, externalId } },
      update: {
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
        htmlRaw: htmlExtracted,
        textExtracted: textExtracted || null,
      },
      create: {
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
        htmlRaw: htmlExtracted,
        textExtracted: textExtracted || null,
      },
    });

    if (existing) updated += 1;
    else inserted += 1;
  }

  await prisma.rssSource.update({
    where: { id: source.id },
    data: { lastSyncedAt: new Date() },
  });

  return { inserted, updated };
}

