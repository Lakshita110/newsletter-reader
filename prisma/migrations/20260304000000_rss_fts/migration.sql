-- Add full-text search vector to RssItem.
-- Generated column computed from title + textExtracted + snippet; maintained automatically by Postgres.
-- Prisma does not manage this column — access it only via $queryRaw.

ALTER TABLE "RssItem"
  ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(snippet, '') || ' ' ||
      coalesce("textExtracted", '')
    )
  ) STORED;

CREATE INDEX "RssItem_searchVector_idx" ON "RssItem" USING GIN ("searchVector");
