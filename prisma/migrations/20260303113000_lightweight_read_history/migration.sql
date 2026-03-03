-- Keep lightweight metadata for long-term recommendation history.
ALTER TABLE "MessageReadStat"
ADD COLUMN "messageTitle" TEXT,
ADD COLUMN "sourceKind" TEXT,
ADD COLUMN "publicationName" TEXT;
