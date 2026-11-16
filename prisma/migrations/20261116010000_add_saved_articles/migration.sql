-- Additive only: one new table and one nullable User column.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "saveToken" TEXT;

-- CreateTable
CREATE TABLE "SavedArticle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "siteName" TEXT,
    "author" TEXT,
    "excerpt" TEXT,
    "imageUrl" TEXT,
    "html" TEXT,
    "text" TEXT,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "savedVia" TEXT NOT NULL DEFAULT 'app',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedArticle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_saveToken_key" ON "User"("saveToken");
CREATE UNIQUE INDEX "SavedArticle_userId_url_key" ON "SavedArticle"("userId", "url");
CREATE INDEX "SavedArticle_userId_createdAt_idx" ON "SavedArticle"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "SavedArticle" ADD CONSTRAINT "SavedArticle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
