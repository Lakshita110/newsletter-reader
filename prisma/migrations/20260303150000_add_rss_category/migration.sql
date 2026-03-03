ALTER TABLE "UserRssSubscription"
ADD COLUMN "category" TEXT;

UPDATE "UserRssSubscription"
SET "category" = 'other'
WHERE "category" IS NULL;

ALTER TABLE "UserRssSubscription"
ALTER COLUMN "category" SET NOT NULL,
ALTER COLUMN "category" SET DEFAULT 'other';
