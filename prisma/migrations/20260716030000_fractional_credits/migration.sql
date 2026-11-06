ALTER TABLE "User"
  ALTER COLUMN "credits" TYPE DOUBLE PRECISION USING "credits"::DOUBLE PRECISION,
  ALTER COLUMN "credits" SET DEFAULT 100;

ALTER TABLE "UsageLog"
  ALTER COLUMN "creditsDelta" TYPE DOUBLE PRECISION USING "creditsDelta"::DOUBLE PRECISION;

INSERT INTO "ModelPricing" (
  "id", "modelId", "image2Mode", "resolution", "credits", "priority",
  "isActive", "note", "createdAt", "updatedAt"
)
SELECT
  'pricing_image2_standard_auto', 'gpt-image-2', 'standard', 'auto', 8, 100,
  true, 'Image2 标准版自动尺寸', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "ModelPricing"
  WHERE "modelId" = 'gpt-image-2'
    AND "image2Mode" = 'standard'
    AND "resolution" = 'auto'
    AND "aspectRatio" IS NULL
    AND "outputFormat" IS NULL
    AND "background" IS NULL
    AND "usesReference" IS NULL
);

INSERT INTO "ModelPricing" (
  "id", "modelId", "image2Mode", "resolution", "credits", "priority",
  "isActive", "note", "createdAt", "updatedAt"
)
SELECT
  'pricing_image2_high_auto', 'gpt-image-2', 'high', 'auto', 8, 100,
  true, 'Image2 高推理自动尺寸', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "ModelPricing"
  WHERE "modelId" = 'gpt-image-2'
    AND "image2Mode" = 'high'
    AND "resolution" = 'auto'
    AND "aspectRatio" IS NULL
    AND "outputFormat" IS NULL
    AND "background" IS NULL
    AND "usesReference" IS NULL
);

INSERT INTO "SystemConfig" ("key", "value", "updatedAt")
VALUES
  ('conversation.standardCredits', '0.5'::jsonb, CURRENT_TIMESTAMP),
  ('conversation.reasoningCredits', '1'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE
SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP;
