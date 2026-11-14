-- Raise only the untouched defaults. User-specific overrides remain unchanged.
ALTER TABLE "User" ALTER COLUMN "dailyGenLimit" SET DEFAULT 500;
ALTER TABLE "User" ALTER COLUMN "concurrentLimit" SET DEFAULT 5;

UPDATE "User"
SET "dailyGenLimit" = 500,
    "concurrentLimit" = 5
WHERE "dailyGenLimit" = 50
  AND "concurrentLimit" = 2;

UPDATE "SystemConfig"
SET "value" = '500'::jsonb
WHERE "key" = 'generation.defaultDailyLimit'
  AND "value" = '50'::jsonb;
