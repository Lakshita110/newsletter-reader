import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const statements = [
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "digestEnabled" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "digestTimezone" TEXT NOT NULL DEFAULT 'UTC'`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "weeklyReadingGoal" INTEGER NOT NULL DEFAULT 5`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "digestLastSentAt" TIMESTAMPTZ`,
  `ALTER TABLE "RssSource" ADD COLUMN IF NOT EXISTS "consecutiveFailures" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "RssSource" ADD COLUMN IF NOT EXISTS "lastErrorAt" TIMESTAMPTZ`,
  `ALTER TABLE "RssSource" ADD COLUMN IF NOT EXISTS "lastErrorMessage" VARCHAR(500)`,
  `ALTER TABLE "UserRssDailyRankSnapshot" ADD COLUMN IF NOT EXISTS "rankReasons" JSONB`,
];

for (const sql of statements) {
  await prisma.$executeRawUnsafe(sql);
  console.log("OK:", sql.slice(0, 70));
}

await prisma.$disconnect();
console.log("Done.");
