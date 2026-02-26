import crypto from "crypto";
import Parser from "rss-parser";
import { prisma } from "@/lib/prisma";
import { extractArticleContent } from "@/lib/article-extract";

const parser = new Parser();

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

export async function syncRssSource(rssSourceId: string) {
  const source = await prisma.rssSource.findUnique({ where: { id: rssSourceId } });
  if (!source || !source.isActive) return { inserted: 0, updated: 0 };

  const feed = await parser.parseURL(source.rssUrl);
  let inserted = 0;
  let updated = 0;

  for (const item of feed.items ?? []) {
    const externalId = deriveExternalId(item);
    const html =
      typeof item["content:encoded"] === "string"
        ? item["content:encoded"]
        : typeof item.content === "string"
        ? item.content
        : undefined;
    const extracted = html ? extractArticleContent(html, item.link ?? undefined) : null;
    const textExtracted = extracted?.text || (item.contentSnippet ?? "").trim();
    const htmlExtracted = extracted?.html || html || null;
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
        author: item.creator ?? item.author ?? null,
        link: item.link?.trim() || null,
        publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
        snippet: snippet || null,
        htmlRaw: htmlExtracted,
        textExtracted: textExtracted || null,
      },
      create: {
        rssSourceId: source.id,
        externalId,
        title: item.title?.trim() || "(Untitled)",
        author: item.creator ?? item.author ?? null,
        link: item.link?.trim() || null,
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
