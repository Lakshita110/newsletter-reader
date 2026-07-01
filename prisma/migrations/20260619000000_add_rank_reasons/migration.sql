-- AlterTable
ALTER TABLE "UserRssDailyRankSnapshot" ADD COLUMN "rankReasons" JSONB NOT NULL DEFAULT '{}';
