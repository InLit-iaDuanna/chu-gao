ALTER TABLE "ModelCallLog"
ADD COLUMN "uncachedInputTokens" INTEGER,
ADD COLUMN "cacheReadTokens" INTEGER,
ADD COLUMN "cacheCreationTokens" INTEGER;
