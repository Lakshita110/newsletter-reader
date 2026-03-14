-- AlterTable
ALTER TABLE "User"
ADD COLUMN "rssRecommendationCap" INTEGER NOT NULL DEFAULT 35,
ADD COLUMN "rssRecommendationPrompt" VARCHAR(500);
