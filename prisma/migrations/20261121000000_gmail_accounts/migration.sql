-- CreateTable
CREATE TABLE "GmailAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT,
    "refreshTokenEnc" TEXT,
    "tokenError" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GmailAccount_userId_idx" ON "GmailAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GmailAccount_userId_email_key" ON "GmailAccount"("userId", "email");

-- AddForeignKey
ALTER TABLE "GmailAccount" ADD CONSTRAINT "GmailAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry the existing single mailbox over. Copy only: the old User columns are
-- left in place (unused) so nothing is lost if this needs to be rolled back.
-- A mailbox picked with "Use a different Gmail" has an unknown address here;
-- the first sync fills it in from the Gmail profile.
INSERT INTO "GmailAccount" ("id", "userId", "email", "refreshTokenEnc", "tokenError", "syncedAt")
SELECT
    'gm_' || md5(u."id" || clock_timestamp()::text),
    u."id",
    CASE WHEN u."gmailConnectedSeparately" THEN NULL ELSE u."email" END,
    u."gmailRefreshTokenEnc",
    u."gmailTokenError",
    u."newslettersSyncedAt"
FROM "User" u
WHERE u."gmailRefreshTokenEnc" IS NOT NULL OR u."gmailTokenError" IS NOT NULL;
