-- Create enums for RSS ranking snapshot metadata.
CREATE TYPE "RssRankSnapshotStatus" AS ENUM ('AI_SUCCESS', 'FALLBACK_DETERMINISTIC');
CREATE TYPE "RssRankSnapshotSource" AS ENUM ('CRON', 'ON_DEMAND');

-- Per-user/day persisted ranking snapshot.
CREATE TABLE "UserRssDailyRankSnapshot" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "dayKey" TEXT NOT NULL,
  "rankedItemIds" JSONB NOT NULL,
  "status" "RssRankSnapshotStatus" NOT NULL,
  "source" "RssRankSnapshotSource" NOT NULL,
  "model" TEXT,
  "inputFingerprint" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserRssDailyRankSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserRssDailyRankSnapshot_userId_dayKey_key"
  ON "UserRssDailyRankSnapshot"("userId", "dayKey");

CREATE INDEX "UserRssDailyRankSnapshot_dayKey_expiresAt_idx"
  ON "UserRssDailyRankSnapshot"("dayKey", "expiresAt");

ALTER TABLE "UserRssDailyRankSnapshot"
  ADD CONSTRAINT "UserRssDailyRankSnapshot_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Per-user/day distributed lock for ranking jobs.
CREATE TABLE "UserRssRankJobLock" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "dayKey" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserRssRankJobLock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserRssRankJobLock_userId_dayKey_key"
  ON "UserRssRankJobLock"("userId", "dayKey");

CREATE INDEX "UserRssRankJobLock_dayKey_expiresAt_idx"
  ON "UserRssRankJobLock"("dayKey", "expiresAt");

ALTER TABLE "UserRssRankJobLock"
  ADD CONSTRAINT "UserRssRankJobLock_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
