-- CreateTable
CREATE TABLE "ReadState" (
    "id" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReadState_userEmail_idx" ON "ReadState"("userEmail");

-- CreateIndex
CREATE INDEX "ReadState_messageId_idx" ON "ReadState"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "ReadState_userEmail_messageId_key" ON "ReadState"("userEmail", "messageId");
