-- CreateEnum
CREATE TYPE "ConversationStorage" AS ENUM ('CLOUD', 'LOCAL');

-- AlterTable
ALTER TABLE "Conversation"
ADD COLUMN "storage" "ConversationStorage" NOT NULL DEFAULT 'CLOUD',
ADD COLUMN "localDeviceId" TEXT;

-- CreateIndex
CREATE INDEX "Conversation_userId_storage_idx" ON "Conversation"("userId", "storage");
