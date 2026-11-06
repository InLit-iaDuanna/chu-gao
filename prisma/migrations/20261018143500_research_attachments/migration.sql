CREATE TABLE "ResearchAttachment" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "purgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResearchAttachment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ResearchAttachment_projectId_sourceKey_key" ON "ResearchAttachment"("projectId", "sourceKey");
ALTER TABLE "ResearchAttachment" ADD CONSTRAINT "ResearchAttachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
