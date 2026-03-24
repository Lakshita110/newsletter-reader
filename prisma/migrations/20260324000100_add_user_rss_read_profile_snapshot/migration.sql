-- CreateTable
CREATE TABLE "UserRssReadProfileSnapshot" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "weekKey" TEXT NOT NULL,
  "topPublications" JSONB NOT NULL,
  "avgCompletionPct" DOUBLE PRECISION NOT NULL,
  "recentReadCount7d" INTEGER NOT NULL,
  "preferenceSummary" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserRssReadProfileSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserRssReadProfileSnapshot_userId_key" ON "UserRssReadProfileSnapshot"("userId");

-- CreateIndex
CREATE INDEX "UserRssReadProfileSnapshot_weekKey_updatedAt_idx" ON "UserRssReadProfileSnapshot"("weekKey", "updatedAt");

-- AddForeignKey
ALTER TABLE "UserRssReadProfileSnapshot" ADD CONSTRAINT "UserRssReadProfileSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
