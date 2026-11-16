-- Additive only: two new tables and one nullable column. No existing data changes.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "newslettersSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "NewsletterSender" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsletterSender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsletterIssue" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "threadId" TEXT,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "publicationKey" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "snippet" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "html" TEXT,
    "text" TEXT,
    "webUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsletterIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSender_userId_email_key" ON "NewsletterSender"("userId", "email");
CREATE INDEX "NewsletterSender_userId_isActive_idx" ON "NewsletterSender"("userId", "isActive");
CREATE UNIQUE INDEX "NewsletterIssue_userId_gmailMessageId_key" ON "NewsletterIssue"("userId", "gmailMessageId");
CREATE INDEX "NewsletterIssue_userId_receivedAt_idx" ON "NewsletterIssue"("userId", "receivedAt");

-- AddForeignKey
ALTER TABLE "NewsletterSender" ADD CONSTRAINT "NewsletterSender_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsletterIssue" ADD CONSTRAINT "NewsletterIssue_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
