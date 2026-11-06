-- AlterTable
ALTER TABLE "ConversationMessage" ADD COLUMN     "chatAttemptId" TEXT,
ADD COLUMN     "chatError" JSONB,
ADD COLUMN     "chatReferences" JSONB,
ADD COLUMN     "chatSources" JSONB,
ADD COLUMN     "chatStatus" TEXT,
ADD COLUMN     "chatTurnId" TEXT,
ADD COLUMN     "chatUsage" JSONB;

-- CreateTable
CREATE TABLE "ChatTurn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "configSnapshot" JSONB NOT NULL,
    "modelId" TEXT NOT NULL,
    "priceCredits" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "chargedCredits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "activeConversationId" TEXT,
    "activeAttemptId" TEXT,
    "nextSeq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatAttempt" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "retryRequestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "mode" TEXT NOT NULL DEFAULT 'native_responses',
    "activity" TEXT NOT NULL DEFAULT 'queued',
    "heldCredits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "billingState" TEXT NOT NULL DEFAULT 'reserved',
    "rawText" TEXT NOT NULL DEFAULT '',
    "parts" JSONB,
    "sources" JSONB,
    "usage" JSONB,
    "error" JSONB,
    "responseId" TEXT,
    "requestId" TEXT,
    "executionToken" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatEvent" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatTurn_activeConversationId_key" ON "ChatTurn"("activeConversationId");

-- CreateIndex
CREATE INDEX "ChatTurn_conversationId_createdAt_idx" ON "ChatTurn"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatTurn_userId_clientRequestId_key" ON "ChatTurn"("userId", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatAttempt_retryRequestId_key" ON "ChatAttempt"("retryRequestId");

-- CreateIndex
CREATE INDEX "ChatAttempt_status_createdAt_idx" ON "ChatAttempt"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ChatAttempt_status_heartbeatAt_idx" ON "ChatAttempt"("status", "heartbeatAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatAttempt_turnId_ordinal_key" ON "ChatAttempt"("turnId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "ChatEvent_turnId_seq_key" ON "ChatEvent"("turnId", "seq");

-- CreateIndex
CREATE INDEX "ConversationMessage_chatTurnId_idx" ON "ConversationMessage"("chatTurnId");

-- CreateIndex
CREATE INDEX "ConversationMessage_chatAttemptId_idx" ON "ConversationMessage"("chatAttemptId");

-- AddForeignKey
ALTER TABLE "ChatTurn" ADD CONSTRAINT "ChatTurn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatTurn" ADD CONSTRAINT "ChatTurn_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatAttempt" ADD CONSTRAINT "ChatAttempt_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "ChatTurn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatEvent" ADD CONSTRAINT "ChatEvent_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "ChatTurn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatEvent" ADD CONSTRAINT "ChatEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ChatAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
