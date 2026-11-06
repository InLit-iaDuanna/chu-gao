ALTER TABLE "ModelPricing"
  ADD COLUMN IF NOT EXISTS "providerChannelId" TEXT;

CREATE INDEX IF NOT EXISTS "ModelPricing_providerChannelId_idx"
  ON "ModelPricing"("providerChannelId");
