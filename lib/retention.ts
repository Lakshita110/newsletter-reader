import { prisma } from "@/lib/prisma";

type RetentionConfig = {
  htmlRetentionDays: number;
  maxMessages: number;
  deleteBatchSize: number;
  dbHighWaterMb: number;
  dbTargetMb: number;
};

function getConfig(): RetentionConfig {
  const htmlRetentionDays = Number(process.env.RETENTION_HTML_DAYS ?? 30);
  const maxMessages = Number(process.env.RETENTION_MAX_MESSAGES ?? 5000);
  const deleteBatchSize = Number(process.env.RETENTION_DELETE_BATCH_SIZE ?? 250);
  const dbHighWaterMb = Number(process.env.RETENTION_DB_HIGH_WATER_MB ?? 420);
  const dbTargetMb = Number(process.env.RETENTION_DB_TARGET_MB ?? 350);

  return {
    htmlRetentionDays: Number.isFinite(htmlRetentionDays) ? htmlRetentionDays : 30,
    maxMessages: Number.isFinite(maxMessages) ? maxMessages : 5000,
    deleteBatchSize: Number.isFinite(deleteBatchSize) ? deleteBatchSize : 250,
    dbHighWaterMb: Number.isFinite(dbHighWaterMb) ? dbHighWaterMb : 420,
    dbTargetMb: Number.isFinite(dbTargetMb) ? dbTargetMb : 350,
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

export async function runRetentionNow() {
  const cfg = getConfig();
  const cutoff = new Date(Date.now() - cfg.htmlRetentionDays * 24 * 60 * 60 * 1000);

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

  const finalMessages = await prisma.message.count();

  return {
    ok: true,
    config: cfg,
    htmlPruned: htmlPruned.count,
    deletedByCountCap,
    deletedByDbPressure,
    messagesRemaining: finalMessages,
    dbSizeMbBefore: bytesToMb(beforeDbBytes),
    dbSizeMbAfter: bytesToMb(afterDbBytes),
    ranAt: new Date().toISOString(),
  };
}

