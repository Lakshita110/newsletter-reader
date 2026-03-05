-- CreateTable: SavedArticle
CREATE TABLE "SavedArticle" (
    "id"     TEXT        NOT NULL,
    "userId" TEXT        NOT NULL,
    "url"    TEXT        NOT NULL,
    "title"  TEXT        NOT NULL,
    "author" TEXT,
    "source" TEXT,
    "text"   TEXT        NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedArticle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SavedArticle_userId_url_key" ON "SavedArticle"("userId", "url");
CREATE INDEX "SavedArticle_userId_savedAt_idx" ON "SavedArticle"("userId", "savedAt");

ALTER TABLE "SavedArticle"
  ADD CONSTRAINT "SavedArticle_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Full-text search vector for SavedArticle (same pattern as RssItem)
ALTER TABLE "SavedArticle"
  ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(text, ''))
  ) STORED;

CREATE INDEX "SavedArticle_searchVector_idx" ON "SavedArticle" USING GIN ("searchVector");

-- CreateTable: Highlight
CREATE TABLE "Highlight" (
    "id"             TEXT        NOT NULL,
    "userId"         TEXT        NOT NULL,
    "text"           TEXT        NOT NULL,
    "note"           TEXT,
    "rssItemId"      TEXT,
    "savedArticleId" TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Highlight_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Highlight_userId_createdAt_idx" ON "Highlight"("userId", "createdAt");

ALTER TABLE "Highlight"
  ADD CONSTRAINT "Highlight_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Highlight"
  ADD CONSTRAINT "Highlight_rssItemId_fkey"
  FOREIGN KEY ("rssItemId") REFERENCES "RssItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Highlight"
  ADD CONSTRAINT "Highlight_savedArticleId_fkey"
  FOREIGN KEY ("savedArticleId") REFERENCES "SavedArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
