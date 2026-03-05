ALTER TABLE "MessageReadStat"
ADD COLUMN "savedAt" TIMESTAMP(3);

CREATE INDEX "MessageReadStat_userId_savedAt_idx"
ON "MessageReadStat"("userId", "savedAt");
