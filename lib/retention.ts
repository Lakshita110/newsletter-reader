import { prisma } from "@/lib/prisma";

type RetentionConfig = {
  rssRetentionDays: number;
  rssMaxItemsPerSource: number;
};

function getConfig(): RetentionConfig {
  const rssRetentionDays = Number(process.env.RETENTION_RSS_DAYS ?? 5);
  const rssMaxItemsPerSource = Number(process.env.RETENTION_RSS_MAX_ITEMS_PER_SOURCE ?? 500);

  return {
    rssRetentionDays: Number.isFinite(rssRetentionDays) ? rssRetentionDays : 5,
    rssMaxItemsPerSource: Number.isFinite(rssMaxItemsPerSource) ? rssMaxItemsPerSource : 500,
  };
}

function bytesToMb(value: number): number {
  return Math.round((value / 1024 / 1024) * 100) / 100;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return 0;
}

async function getDatabaseSizeBytes(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ bytes: bigint | number | string }>>`
    SELECT pg_database_size(current_database()) AS bytes
  `;
  return toNumber(rows[0]?.bytes);
}

async function pruneRssByAge(days: number): Promise<number> {
  if (days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const deletedRows = await prisma.$queryRaw<Array<{ count: bigint | number | string }>>`
    WITH saved_items AS (
      SELECT DISTINCT SUBSTRING("messageExternalId" FROM 5) AS id
      FROM "MessageReadStat"
      WHERE "savedAt" IS NOT NULL
        AND "messageExternalId" LIKE 'rss:%'
    ),
    deleted AS (
      DELETE FROM "RssItem" r
      WHERE (
        r."publishedAt" < ${cutoff}
        OR (r."publishedAt" IS NULL AND r."createdAt" < ${cutoff})
      )
        AND NOT EXISTS (
          SELECT 1
          FROM saved_items s
          WHERE s.id = r.id
        )
      RETURNING 1
    )
    SELECT COUNT(*) AS count FROM deleted
  `;
  return toNumber(deletedRows[0]?.count);
}

async function pruneRssPerSource(maxItemsPerSource: number): Promise<number> {
  if (maxItemsPerSource <= 0) return 0;
  const deletedRows = await prisma.$queryRaw<Array<{ count: bigint | number | string }>>`
    WITH saved_items AS (
      SELECT DISTINCT SUBSTRING("messageExternalId" FROM 5) AS id
      FROM "MessageReadStat"
      WHERE "savedAt" IS NOT NULL
        AND "messageExternalId" LIKE 'rss:%'
    ),
    ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY "rssSourceId"
          ORDER BY COALESCE("publishedAt", "createdAt") DESC, "createdAt" DESC
        ) AS rn
      FROM "RssItem"
    ),
    deleted AS (
      DELETE FROM "RssItem" r
      USING ranked
      WHERE r.id = ranked.id
        AND ranked.rn > ${maxItemsPerSource}
        AND NOT EXISTS (
          SELECT 1
          FROM saved_items s
          WHERE s.id = r.id
        )
      RETURNING 1
    )
    SELECT COUNT(*) AS count FROM deleted
  `;
  return toNumber(deletedRows[0]?.count);
}

async function compactSavedRssHtml(days: number): Promise<number> {
  if (days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const updatedRows = await prisma.$queryRaw<Array<{ count: bigint | number | string }>>`
    WITH saved_items AS (
      SELECT DISTINCT SUBSTRING("messageExternalId" FROM 5) AS id
      FROM "MessageReadStat"
      WHERE "savedAt" IS NOT NULL
        AND "messageExternalId" LIKE 'rss:%'
    ),
    updated AS (
      UPDATE "RssItem" r
      SET "htmlRaw" = NULL
      WHERE r."htmlRaw" IS NOT NULL
        AND (
          r."publishedAt" < ${cutoff}
          OR (r."publishedAt" IS NULL AND r."createdAt" < ${cutoff})
        )
        AND EXISTS (
          SELECT 1
          FROM saved_items s
          WHERE s.id = r.id
        )
      RETURNING 1
    )
    SELECT COUNT(*) AS count FROM updated
  `;
  return toNumber(updatedRows[0]?.count);
}

async function pruneOrphanRssSources(): Promise<number> {
  const result = await prisma.rssSource.deleteMany({
    where: {
      subscriptions: {
        none: { isActive: true },
      },
    },
  });
  return result.count;
}

export async function runRetentionNow() {
  const cfg = getConfig();
  const beforeDbBytes = await getDatabaseSizeBytes();

  const rssSavedItemsCompacted = await compactSavedRssHtml(cfg.rssRetentionDays);
  const rssDeletedByAge = await pruneRssByAge(cfg.rssRetentionDays);
  const rssDeletedByPerSourceCap = await pruneRssPerSource(cfg.rssMaxItemsPerSource);
  const rssSourcesDeletedOrphaned = await pruneOrphanRssSources();

  const rssItemsRemaining = await prisma.rssItem.count();
  const rssSourcesRemaining = await prisma.rssSource.count();
  const afterDbBytes = await getDatabaseSizeBytes();

  return {
    ok: true,
    config: cfg,
    rssSavedItemsCompacted,
    rssDeletedByAge,
    rssDeletedByPerSourceCap,
    rssSourcesDeletedOrphaned,
    rssItemsRemaining,
    rssSourcesRemaining,
    dbSizeMbBefore: bytesToMb(beforeDbBytes),
    dbSizeMbAfter: bytesToMb(afterDbBytes),
    ranAt: new Date().toISOString(),
  };
}
