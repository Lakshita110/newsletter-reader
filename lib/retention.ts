import { prisma } from "@/lib/prisma";

type RetentionConfig = {
  messageRetentionDays: number;
  htmlRetentionDays: number;
  maxMessages: number;
  deleteBatchSize: number;
  dbHighWaterMb: number;
  dbTargetMb: number;
  rssRetentionDays: number;
  rssMaxItemsPerSource: number;
};

function getConfig(): RetentionConfig {
  const messageRetentionDays = Number(process.env.RETENTION_MESSAGE_DAYS ?? 5);
  const htmlRetentionDays = Number(process.env.RETENTION_HTML_DAYS ?? 5);
  const maxMessages = Number(process.env.RETENTION_MAX_MESSAGES ?? 5000);
  const deleteBatchSize = Number(process.env.RETENTION_DELETE_BATCH_SIZE ?? 250);
  const dbHighWaterMb = Number(process.env.RETENTION_DB_HIGH_WATER_MB ?? 420);
  const dbTargetMb = Number(process.env.RETENTION_DB_TARGET_MB ?? 350);
  const rssRetentionDays = Number(process.env.RETENTION_RSS_DAYS ?? 5);
  const rssMaxItemsPerSource = Number(process.env.RETENTION_RSS_MAX_ITEMS_PER_SOURCE ?? 500);

  return {
    messageRetentionDays: Number.isFinite(messageRetentionDays) ? messageRetentionDays : 5,
    htmlRetentionDays: Number.isFinite(htmlRetentionDays) ? htmlRetentionDays : 5,
    maxMessages: Number.isFinite(maxMessages) ? maxMessages : 5000,
    deleteBatchSize: Number.isFinite(deleteBatchSize) ? deleteBatchSize : 250,
    dbHighWaterMb: Number.isFinite(dbHighWaterMb) ? dbHighWaterMb : 420,
    dbTargetMb: Number.isFinite(dbTargetMb) ? dbTargetMb : 350,
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

async function deleteOldestMessages(count: number): Promise<number> {
  if (count <= 0) return 0;

  const targets = await prisma.message.findMany({
    select: { id: true },
    orderBy: [{ sentAt: "asc" }, { createdAt: "asc" }],
    take: count,
  });

  if (targets.length === 0) return 0;

  const result = await prisma.message.deleteMany({
    where: { id: { in: targets.map((t) => t.id) } },
  });

  return result.count;
}

async function pruneMessagesByAge(days: number): Promise<number> {
  if (days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await prisma.message.deleteMany({
    where: {
      OR: [
        { sentAt: { lt: cutoff } },
        { AND: [{ sentAt: null }, { fetchedAt: { lt: cutoff } }] },
      ],
    },
  });
  return result.count;
}

async function pruneRssByAge(days: number): Promise<number> {
  if (days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await prisma.rssItem.deleteMany({
    where: {
      OR: [
        { publishedAt: { lt: cutoff } },
        { AND: [{ publishedAt: null }, { createdAt: { lt: cutoff } }] },
      ],
    },
  });
  return result.count;
}

async function pruneRssPerSource(maxItemsPerSource: number): Promise<number> {
  if (maxItemsPerSource <= 0) return 0;
  const deletedRows = await prisma.$queryRaw<Array<{ count: bigint | number | string }>>`
    WITH ranked AS (
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
      RETURNING 1
    )
    SELECT COUNT(*) AS count FROM deleted
  `;
  return toNumber(deletedRows[0]?.count);
}

export async function runRetentionNow() {
  const cfg = getConfig();
  const cutoff = new Date(Date.now() - cfg.htmlRetentionDays * 24 * 60 * 60 * 1000);

  const messagesDeletedByAge = await pruneMessagesByAge(cfg.messageRetentionDays);

  const htmlPruned = await prisma.message.updateMany({
    where: {
      htmlRaw: { not: null },
      OR: [
        { sentAt: { lt: cutoff } },
        { AND: [{ sentAt: null }, { fetchedAt: { lt: cutoff } }] },
      ],
    },
    data: { htmlRaw: null },
  });

  let deletedByCountCap = 0;
  const totalMessages = await prisma.message.count();
  if (totalMessages > cfg.maxMessages) {
    deletedByCountCap = await deleteOldestMessages(totalMessages - cfg.maxMessages);
  }

  const beforeDbBytes = await getDatabaseSizeBytes();
  let deletedByDbPressure = 0;
  let afterDbBytes = beforeDbBytes;

  // If DB usage is too high, keep deleting oldest messages in batches until target is reached.
  if (beforeDbBytes > cfg.dbHighWaterMb * 1024 * 1024) {
    for (let i = 0; i < 20; i++) {
      const deleted = await deleteOldestMessages(cfg.deleteBatchSize);
      if (!deleted) break;
      deletedByDbPressure += deleted;

      afterDbBytes = await getDatabaseSizeBytes();
      if (afterDbBytes <= cfg.dbTargetMb * 1024 * 1024) break;
    }
  }

  const rssDeletedByAge = await pruneRssByAge(cfg.rssRetentionDays);
  const rssDeletedByPerSourceCap = await pruneRssPerSource(cfg.rssMaxItemsPerSource);

  const finalMessages = await prisma.message.count();
  const rssItemsRemaining = await prisma.rssItem.count();

  return {
    ok: true,
    config: cfg,
    messagesDeletedByAge,
    htmlPruned: htmlPruned.count,
    deletedByCountCap,
    deletedByDbPressure,
    messagesRemaining: finalMessages,
    rssDeletedByAge,
    rssDeletedByPerSourceCap,
    rssItemsRemaining,
    dbSizeMbBefore: bytesToMb(beforeDbBytes),
    dbSizeMbAfter: bytesToMb(afterDbBytes),
    ranAt: new Date().toISOString(),
  };
}
