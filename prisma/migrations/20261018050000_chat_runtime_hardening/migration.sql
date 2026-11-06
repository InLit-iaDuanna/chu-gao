ALTER TABLE "Conversation" ADD COLUMN "contextRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ChatAttempt"
  ADD COLUMN "protocolVersion" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "queueDeadline" TIMESTAMP(3),
  ADD COLUMN "requestHash" TEXT,
  ADD COLUMN "contextSnapshotId" TEXT,
  ADD COLUMN "contextManifest" JSONB,
  ADD COLUMN "timings" JSONB;
CREATE INDEX "ChatAttempt_status_protocolVersion_createdAt_idx" ON "ChatAttempt"("status", "protocolVersion", "createdAt");

CREATE TABLE "ChatRequestReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "clientRequestId" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "turnId" TEXT NOT NULL,
  "attemptId" TEXT,
  "contentClearedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ChatRequestReceipt_userId_scope_clientRequestId_key" ON "ChatRequestReceipt"("userId", "scope", "clientRequestId");
CREATE INDEX "ChatRequestReceipt_conversationId_idx" ON "ChatRequestReceipt"("conversationId");
CREATE INDEX "ChatRequestReceipt_turnId_idx" ON "ChatRequestReceipt"("turnId");

CREATE TABLE "CreditEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "operationKey" TEXT NOT NULL,
  "payloadHash" TEXT,
  "kind" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "actorId" TEXT,
  "turnId" TEXT,
  "attemptId" TEXT,
  "turnSettlementKey" TEXT,
  "availableDelta" DECIMAL(18,6) NOT NULL,
  "heldDelta" DECIMAL(18,6) NOT NULL,
  "consumedDelta" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "balanceAfter" DECIMAL(18,6),
  "result" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditEntry_chat_conservation" CHECK (
    "kind" NOT LIKE 'chat.%' OR "availableDelta" + "heldDelta" + "consumedDelta" = 0
  )
);
CREATE UNIQUE INDEX "CreditEntry_operationKey_key" ON "CreditEntry"("operationKey");
CREATE UNIQUE INDEX "CreditEntry_turnSettlementKey_key" ON "CreditEntry"("turnSettlementKey");
CREATE INDEX "CreditEntry_userId_createdAt_idx" ON "CreditEntry"("userId", "createdAt");
CREATE INDEX "CreditEntry_attemptId_idx" ON "CreditEntry"("attemptId");
CREATE INDEX "CreditEntry_turnId_idx" ON "CreditEntry"("turnId");

-- Preserve request identity and chat hold history at the cutover, without
-- changing any account balance or creating a second economic transaction.
INSERT INTO "ChatRequestReceipt" ("id", "userId", "scope", "clientRequestId", "inputHash", "conversationId", "turnId", "createdAt")
SELECT 'receipt_' || md5("id"), "userId", 'create', "clientRequestId", "inputHash", "conversationId", "id", "createdAt" FROM "ChatTurn";
INSERT INTO "ChatRequestReceipt" ("id", "userId", "scope", "clientRequestId", "inputHash", "conversationId", "turnId", "attemptId", "createdAt")
SELECT 'retry_receipt_' || md5(a."id"), t."userId", 'retry', substr(a."retryRequestId", length(t."userId") + 2),
  'migrated:' || a."id", t."conversationId", t."id", a."id", a."createdAt"
FROM "ChatAttempt" a JOIN "ChatTurn" t ON t."id" = a."turnId" WHERE a."retryRequestId" IS NOT NULL;
INSERT INTO "CreditEntry" ("id", "operationKey", "kind", "userId", "turnId", "attemptId", "availableDelta", "heldDelta", "consumedDelta", "createdAt")
SELECT 'reserve_' || a."id", 'reserve:' || a."id", 'chat.reserve', t."userId", t."id", a."id",
  -round(a."heldCredits"::numeric, 6), round(a."heldCredits"::numeric, 6), 0, a."createdAt"
FROM "ChatAttempt" a JOIN "ChatTurn" t ON t."id" = a."turnId";
INSERT INTO "CreditEntry" ("id", "operationKey", "kind", "userId", "turnId", "attemptId", "turnSettlementKey", "availableDelta", "heldDelta", "consumedDelta", "createdAt")
SELECT 'close_' || a."id", 'close:' || a."id", CASE WHEN a."billingState" = 'charged' THEN 'chat.settle' ELSE 'chat.release' END,
  t."userId", t."id", a."id", CASE WHEN a."billingState" = 'charged' THEN 'settle:' || t."id" ELSE NULL END,
  CASE WHEN a."billingState" = 'charged' THEN 0 ELSE round(a."heldCredits"::numeric, 6) END,
  -round(a."heldCredits"::numeric, 6),
  CASE WHEN a."billingState" = 'charged' THEN round(a."heldCredits"::numeric, 6) ELSE 0 END,
  COALESCE(a."finishedAt", a."createdAt")
FROM "ChatAttempt" a JOIN "ChatTurn" t ON t."id" = a."turnId" WHERE a."billingState" IN ('charged', 'released');

CREATE TABLE "ContextSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "throughTurnId" TEXT,
  "sourceHash" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "pinnedConstraints" JSONB,
  "attachmentManifest" JSONB,
  "toolResultManifest" JSONB,
  "summarizerProfileVersion" TEXT NOT NULL,
  "estimatorVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContextSnapshot_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ContextSnapshot_conversationId_sourceHash_summarizerProfileVe_key" ON "ContextSnapshot"("conversationId", "sourceHash", "summarizerProfileVersion", "estimatorVersion");
CREATE INDEX "ContextSnapshot_conversationId_revision_idx" ON "ContextSnapshot"("conversationId", "revision");
