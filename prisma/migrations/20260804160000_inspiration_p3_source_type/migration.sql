-- Persist the in-product tool that handed a post to the inspiration composer.
-- This turns Canvas / Nodes / PPT publishing into a durable P3 content source
-- instead of a transient client-side prefill detail.
CREATE TYPE "PostSourceType" AS ENUM ('STANDARD', 'CANVAS', 'NODES', 'PPT');

ALTER TABLE "DesignPost"
ADD COLUMN "sourceType" "PostSourceType" NOT NULL DEFAULT 'STANDARD';

CREATE INDEX "DesignPost_sourceType_status_publishedAt_idx"
ON "DesignPost"("sourceType", "status", "publishedAt" DESC);
