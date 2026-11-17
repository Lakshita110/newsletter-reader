-- Catch-up for columns that were added to schema.prisma and applied to
-- production with `prisma db push`, but never got a migration. Production
-- already has them, so every statement is IF NOT EXISTS: a no-op there, and
-- a fresh database built from migrations now matches the schema. CI checks
-- that this stays true (see .github/workflows/ci.yml, "Migrations match schema").

-- AlterTable
ALTER TABLE "RssSource" ADD COLUMN IF NOT EXISTS "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "lastErrorAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastErrorMessage" VARCHAR(500);

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "digestEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "digestLastSentAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "digestTimezone" TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN IF NOT EXISTS "weeklyReadingGoal" INTEGER NOT NULL DEFAULT 5;

-- Full-text search column from the baseline migration. A later `db push`
-- (schema.prisma didn't declare it then) can drop it, which silently pushed
-- search onto its slow fallback. Recreate it where it's missing.
ALTER TABLE "RssItem"
  ADD COLUMN IF NOT EXISTS "searchVector" tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(snippet, '') || ' ' ||
      coalesce("textExtracted", '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS "RssItem_searchVector_idx" ON "RssItem" USING GIN ("searchVector");
