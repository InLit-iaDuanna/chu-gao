-- CreateTable
CREATE TABLE "ResearchProject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "conversationId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchBrief" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "sourceTaskId" TEXT,
    "preset" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "reasoningEffort" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "configSnapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "nextSeq" INTEGER NOT NULL DEFAULT 0,
    "llmCalls" INTEGER NOT NULL DEFAULT 0,
    "searchCalls" INTEGER NOT NULL DEFAULT 0,
    "crawlCalls" INTEGER NOT NULL DEFAULT 0,
    "executionToken" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchStage" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "activeAttemptId" TEXT,
    "text" TEXT NOT NULL DEFAULT '',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchAttempt" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "retryRequestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "remoteRunId" TEXT,
    "remoteCursor" INTEGER NOT NULL DEFAULT 0,
    "text" TEXT NOT NULL DEFAULT '',
    "error" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchEvidence" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL DEFAULT '',
    "contentKey" TEXT,
    "screenshotKey" TEXT,
    "media" JSONB,
    "contentHash" TEXT,
    "originUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'link_only',
    "claims" JSONB,
    "fetchedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchArtifact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "basisTaskId" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchCall" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "usage" JSONB,
    "continuationEnc" TEXT,
    "costUsd" DECIMAL(18,6),
    "costBasis" TEXT NOT NULL DEFAULT 'unknown',
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ResearchCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchProject_userId_updatedAt_idx" ON "ResearchProject"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ResearchBrief_projectId_revision_key" ON "ResearchBrief"("projectId", "revision");

-- CreateIndex
CREATE INDEX "ResearchTask_status_createdAt_idx" ON "ResearchTask"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchTask_projectId_createdAt_idx" ON "ResearchTask"("projectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ResearchTask_expiresAt_idx" ON "ResearchTask"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchTask_userId_clientRequestId_key" ON "ResearchTask"("userId", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchStage_taskId_ordinal_key" ON "ResearchStage"("taskId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchAttempt_retryRequestId_key" ON "ResearchAttempt"("retryRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchAttempt_stageId_ordinal_key" ON "ResearchAttempt"("stageId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchEvent_taskId_seq_key" ON "ResearchEvent"("taskId", "seq");

-- CreateIndex
CREATE INDEX "ResearchEvidence_projectId_createdAt_idx" ON "ResearchEvidence"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchEvidence_taskId_sourceKey_key" ON "ResearchEvidence"("taskId", "sourceKey");

-- CreateIndex
CREATE INDEX "ResearchArtifact_projectId_createdAt_idx" ON "ResearchArtifact"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchArtifact_taskId_filename_key" ON "ResearchArtifact"("taskId", "filename");

-- CreateIndex
CREATE INDEX "ResearchCall_taskId_kind_status_idx" ON "ResearchCall"("taskId", "kind", "status");

-- AddForeignKey
ALTER TABLE "ResearchProject" ADD CONSTRAINT "ResearchProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchBrief" ADD CONSTRAINT "ResearchBrief_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchTask" ADD CONSTRAINT "ResearchTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchTask" ADD CONSTRAINT "ResearchTask_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "ResearchBrief"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchStage" ADD CONSTRAINT "ResearchStage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ResearchTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchAttempt" ADD CONSTRAINT "ResearchAttempt_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ResearchStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchEvent" ADD CONSTRAINT "ResearchEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ResearchTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchEvidence" ADD CONSTRAINT "ResearchEvidence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchEvidence" ADD CONSTRAINT "ResearchEvidence_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ResearchTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchArtifact" ADD CONSTRAINT "ResearchArtifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchArtifact" ADD CONSTRAINT "ResearchArtifact_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ResearchTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchCall" ADD CONSTRAINT "ResearchCall_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ResearchTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchCall" ADD CONSTRAINT "ResearchCall_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ResearchAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

