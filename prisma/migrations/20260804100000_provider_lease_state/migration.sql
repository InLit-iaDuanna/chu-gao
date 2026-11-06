CREATE TABLE "ProviderAccountLease" (
  "id" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "generationId" TEXT NOT NULL,
  "executionToken" TEXT NOT NULL,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "releaseReason" TEXT,

  CONSTRAINT "ProviderAccountLease_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProviderAccountLease"
  ADD CONSTRAINT "ProviderAccountLease_providerAccountId_fkey"
  FOREIGN KEY ("providerAccountId") REFERENCES "ProviderAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProviderAccountLease"
  ADD CONSTRAINT "ProviderAccountLease_generationId_fkey"
  FOREIGN KEY ("generationId") REFERENCES "Generation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ProviderAccountLease_providerAccountId_releasedAt_idx"
  ON "ProviderAccountLease"("providerAccountId", "releasedAt");

CREATE INDEX "ProviderAccountLease_generationId_releasedAt_idx"
  ON "ProviderAccountLease"("generationId", "releasedAt");

CREATE INDEX "ProviderAccountLease_executionToken_idx"
  ON "ProviderAccountLease"("executionToken");

CREATE UNIQUE INDEX "ProviderAccountLease_active_generation_execution_key"
  ON "ProviderAccountLease"("generationId", "executionToken")
  WHERE "releasedAt" IS NULL;

-- Backfill executions that were already running when lease tracking was added.
INSERT INTO "ProviderAccountLease" (
  "id",
  "providerAccountId",
  "generationId",
  "executionToken",
  "acquiredAt"
)
SELECT
  md5(g."id" || ':' || g."executionToken"),
  g."providerAccountId",
  g."id",
  g."executionToken",
  COALESCE(g."startedAt", CURRENT_TIMESTAMP)
FROM "Generation" g
WHERE g."status" = 'RUNNING'
  AND g."providerAccountId" IS NOT NULL
  AND g."executionToken" IS NOT NULL;

UPDATE "ProviderAccount" pa
SET "inFlight" = (
  SELECT COUNT(*)::integer
  FROM "ProviderAccountLease" l
  WHERE l."providerAccountId" = pa."id"
    AND l."releasedAt" IS NULL
);
