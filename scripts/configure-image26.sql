\set ON_ERROR_STOP on

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('gpt-image-2.5-flare'), ('gpt-image-2.5-sunburst')) AS source(model_id)
    CROSS JOIN (VALUES ('1K'), ('2K'), ('4K'), ('auto')) AS tier(resolution)
    WHERE NOT EXISTS (
      SELECT 1 FROM "ModelPricing" AS price
      WHERE price."modelId" = source.model_id
        AND price."providerChannelId" IS NULL
        AND price."image2Mode" IS NULL
        AND price."resolution" = tier.resolution
        AND price."aspectRatio" IS NULL
        AND price."outputFormat" IS NULL
        AND price."background" IS NULL
        AND price."usesReference" IS NULL
        AND price."isActive"
    )
  ) THEN
    RAISE EXCEPTION 'Image2.5 global prices must exist for every tier before copying';
  END IF;
END $$;

WITH model_map(target, source) AS (
  VALUES
    ('gpt-image-2.6', 'gpt-image-2.5-flare'),
    ('gpt-image-2.6-flare', 'gpt-image-2.5-flare'),
    ('gpt-image-2.6-sunburst', 'gpt-image-2.5-sunburst')
)
INSERT INTO "ModelPricing" (
  "id", "modelId", "providerChannelId", "image2Mode", "resolution",
  "aspectRatio", "outputFormat", "background", "usesReference",
  "credits", "priority", "isActive", "note", "createdAt", "updatedAt"
)
SELECT
  'pricing_image26_' || md5(model_map.target || ':' || source."id"),
  model_map.target, source."providerChannelId", source."image2Mode", source."resolution",
  source."aspectRatio", source."outputFormat", source."background", source."usesReference",
  source."credits", source."priority", true,
  'Initial price copied from ' || model_map.source,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM model_map
JOIN "ModelPricing" AS source ON source."modelId" = model_map.source AND source."isActive"
WHERE NOT EXISTS (
  SELECT 1 FROM "ModelPricing" AS existing
  WHERE existing."modelId" = model_map.target
    AND existing."providerChannelId" IS NOT DISTINCT FROM source."providerChannelId"
    AND existing."image2Mode" IS NOT DISTINCT FROM source."image2Mode"
    AND existing."resolution" IS NOT DISTINCT FROM source."resolution"
    AND existing."aspectRatio" IS NOT DISTINCT FROM source."aspectRatio"
    AND existing."outputFormat" IS NOT DISTINCT FROM source."outputFormat"
    AND existing."background" IS NOT DISTINCT FROM source."background"
    AND existing."usesReference" IS NOT DISTINCT FROM source."usesReference"
)
ON CONFLICT ("id") DO NOTHING;

WITH channel_models(base_url, model_ids) AS (
  VALUES
    ('https://ai.ldai.us', ARRAY['gpt-image-2.6', 'gpt-image-2.6-flare', 'gpt-image-2.6-sunburst']),
    ('https://new.sysrv.net', ARRAY['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'])
)
UPDATE "Provider" AS provider
SET "modelsSupported" = provider."modelsSupported" || ARRAY(
  SELECT model_id FROM unnest(channel_models.model_ids) AS model_id
  WHERE NOT model_id = ANY(provider."modelsSupported")
)
FROM channel_models
WHERE rtrim(provider."baseUrl", '/') = channel_models.base_url
  AND provider."protocol" = 'OPENAI_IMAGES'
  AND NOT channel_models.model_ids <@ provider."modelsSupported";

COMMIT;
