-- Add the explicit administrator-controlled access flag for the shared
-- Chūgǎo material inbox test portal.
ALTER TABLE "User"
ADD COLUMN "materialInboxBeta" BOOLEAN NOT NULL DEFAULT false;
