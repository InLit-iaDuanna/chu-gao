CREATE TABLE "ModelCallLog" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "modelId" TEXT NOT NULL,
    "userId" TEXT,
    "generationId" TEXT,
    "imageId" TEXT,
    "conversationId" TEXT,
    "chatAttemptId" TEXT,
    "providerId" TEXT,
    "providerAccountId" TEXT,
    "providerName" TEXT,
    "endpoint" TEXT,
    "requestId" TEXT,
    "httpStatus" INTEGER,
    "errorCategory" TEXT,
    "errorMessage" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    CONSTRAINT "ModelCallLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ModelCallLog_kind_startedAt_idx" ON "ModelCallLog"("kind", "startedAt" DESC);
CREATE INDEX "ModelCallLog_startedAt_id_idx" ON "ModelCallLog"("startedAt" DESC, "id" DESC);
CREATE INDEX "ModelCallLog_source_status_startedAt_idx" ON "ModelCallLog"("source", "status", "startedAt" DESC);
CREATE INDEX "ModelCallLog_generationId_startedAt_idx" ON "ModelCallLog"("generationId", "startedAt");
CREATE INDEX "ModelCallLog_chatAttemptId_idx" ON "ModelCallLog"("chatAttemptId");
CREATE INDEX "ModelCallLog_providerId_startedAt_idx" ON "ModelCallLog"("providerId", "startedAt" DESC);
