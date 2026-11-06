ALTER TABLE "Generation"
  ADD COLUMN "providerLeaseActive" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Generation_providerLeaseActive_idx"
  ON "Generation"("providerLeaseActive");
