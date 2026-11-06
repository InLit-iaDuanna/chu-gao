-- CreateEnum
CREATE TYPE "PPTGenerationStatus" AS ENUM ('PREPARING', 'ENHANCING', 'GENERATING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PPTSlideStatus" AS ENUM ('PENDING', 'ENHANCING', 'GENERATING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "PPTGeneration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "theme" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "slideCount" INTEGER NOT NULL,
    "seed" INTEGER NOT NULL,
    "status" "PPTGenerationStatus" NOT NULL DEFAULT 'PREPARING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PPTGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PPTSlide" (
    "id" TEXT NOT NULL,
    "pptGenerationId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "originalContent" TEXT NOT NULL,
    "enhancedPrompt" TEXT NOT NULL,
    "imageUrl" TEXT,
    "thumbnailUrl" TEXT,
    "generationId" TEXT,
    "status" "PPTSlideStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "seed" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PPTSlide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationRejection" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "ip" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationRejection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PPTGeneration_userId_createdAt_idx" ON "PPTGeneration"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PPTGeneration_conversationId_idx" ON "PPTGeneration"("conversationId");

-- CreateIndex
CREATE INDEX "PPTGeneration_status_idx" ON "PPTGeneration"("status");

-- CreateIndex
CREATE INDEX "PPTSlide_pptGenerationId_index_idx" ON "PPTSlide"("pptGenerationId", "index");

-- CreateIndex
CREATE INDEX "PPTSlide_status_idx" ON "PPTSlide"("status");

-- CreateIndex
CREATE INDEX "ModerationRejection_ip_createdAt_idx" ON "ModerationRejection"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationRejection_userId_createdAt_idx" ON "ModerationRejection"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "PPTGeneration" ADD CONSTRAINT "PPTGeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PPTGeneration" ADD CONSTRAINT "PPTGeneration_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PPTSlide" ADD CONSTRAINT "PPTSlide_pptGenerationId_fkey" FOREIGN KEY ("pptGenerationId") REFERENCES "PPTGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PPTSlide" ADD CONSTRAINT "PPTSlide_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
