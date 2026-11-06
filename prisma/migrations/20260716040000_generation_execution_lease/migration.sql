ALTER TABLE "Generation"
  ADD COLUMN "executionToken" TEXT,
  ADD COLUMN "heartbeatAt" TIMESTAMP(3);

CREATE INDEX "Generation_status_heartbeatAt_idx"
  ON "Generation"("status", "heartbeatAt");
