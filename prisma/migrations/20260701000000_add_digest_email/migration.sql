-- AlterTable
-- Nullable: NULL means "send to the account email" (no backfill needed).
ALTER TABLE "User"
ADD COLUMN "digestEmail" TEXT;
