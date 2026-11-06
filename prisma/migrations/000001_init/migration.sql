-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BANNED');

-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ProviderHealth" AS ENUM ('HEALTHY', 'DEGRADED', 'DOWN');

-- CreateEnum
CREATE TYPE "ProviderProtocol" AS ENUM ('OPENAI_IMAGES', 'OPENAI_RESPONSES_IMAGE', 'GEMINI_IMAGE');

-- CreateEnum
CREATE TYPE "ProviderSelectionStrategy" AS ENUM ('LEAST_IN_FLIGHT', 'ROUND_ROBIN');

-- CreateEnum
CREATE TYPE "ConversationMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "PPTGenerationStatus" AS ENUM ('PREPARING', 'ENHANCING', 'GENERATING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PPTSlideStatus" AS ENUM ('PENDING', 'ENHANCING', 'GENERATING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "credits" INTEGER NOT NULL DEFAULT 100,
    "dailyGenLimit" INTEGER NOT NULL DEFAULT 50,
    "concurrentLimit" INTEGER NOT NULL DEFAULT 2,
    "inviteCodeId" TEXT,
    "bannedAt" TIMESTAMP(3),
    "bannedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InviteCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "initialCredits" INTEGER NOT NULL DEFAULT 100,
    "note" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InviteCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "ConversationMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "generationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Generation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "modelId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "negativePrompt" TEXT,
    "aspectRatio" TEXT NOT NULL,
    "resolution" TEXT,
    "n" INTEGER NOT NULL DEFAULT 1,
    "seed" BIGINT,
    "outputFormat" TEXT NOT NULL DEFAULT 'png',
    "paramsRaw" JSONB NOT NULL,
    "referenceImageKeys" TEXT[],
    "status" "GenerationStatus" NOT NULL DEFAULT 'PENDING',
    "providerId" TEXT,
    "providerAccountId" TEXT,
    "jobId" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "costCredits" INTEGER NOT NULL DEFAULT 0,
    "pricingSnapshot" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Generation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedImage" (
    "id" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/png',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" "ProviderProtocol" NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "health" "ProviderHealth" NOT NULL DEFAULT 'HEALTHY',
    "modelsSupported" TEXT[],
    "costMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "selectionStrategy" "ProviderSelectionStrategy" NOT NULL DEFAULT 'LEAST_IN_FLIGHT',
    "poolMaxConcurrency" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorMsg" TEXT,
    "lastHealthyAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderAccount" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT,
    "baseUrl" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "apiKeyFingerprint" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "maxConcurrency" INTEGER NOT NULL DEFAULT 1,
    "inFlight" INTEGER NOT NULL DEFAULT 0,
    "health" "ProviderHealth" NOT NULL DEFAULT 'HEALTHY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
    "lastLeaseAt" TIMESTAMP(3),
    "lastHealthyAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorMsg" TEXT,
    "cooldownUntil" TIMESTAMP(3),
    "dailyLimit" INTEGER,
    "dailyUsed" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelPricing" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "image2Mode" TEXT,
    "resolution" TEXT,
    "aspectRatio" TEXT,
    "outputFormat" TEXT,
    "background" TEXT,
    "usesReference" BOOLEAN,
    "credits" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelPricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditRedemptionCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "perUserLimit" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditRedemptionCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditRedemption" (
    "id" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "generationId" TEXT,
    "providerId" TEXT,
    "providerAccountId" TEXT,
    "modelId" TEXT,
    "action" TEXT NOT NULL,
    "creditsDelta" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "diff" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PPTGeneration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "title" TEXT,
    "modelId" TEXT,
    "fixedPrompt" TEXT,
    "theme" TEXT,
    "style" TEXT,
    "slideCount" INTEGER,
    "seed" INTEGER,
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
    "type" TEXT NOT NULL DEFAULT 'content',
    "title" TEXT,
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
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "InviteCode_code_key" ON "InviteCode"("code");

-- CreateIndex
CREATE INDEX "InviteCode_code_idx" ON "InviteCode"("code");

-- CreateIndex
CREATE INDEX "Conversation_userId_lastMessageAt_idx" ON "Conversation"("userId", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "Conversation_archivedAt_idx" ON "Conversation"("archivedAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_generationId_idx" ON "ConversationMessage"("generationId");

-- CreateIndex
CREATE INDEX "Generation_userId_createdAt_idx" ON "Generation"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Generation_conversationId_createdAt_idx" ON "Generation"("conversationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Generation_status_idx" ON "Generation"("status");

-- CreateIndex
CREATE INDEX "Generation_deletedAt_idx" ON "Generation"("deletedAt");

-- CreateIndex
CREATE INDEX "Generation_modelId_idx" ON "Generation"("modelId");

-- CreateIndex
CREATE INDEX "Generation_providerAccountId_idx" ON "Generation"("providerAccountId");

-- CreateIndex
CREATE INDEX "GeneratedImage_generationId_idx" ON "GeneratedImage"("generationId");

-- CreateIndex
CREATE INDEX "ProviderAccount_providerId_idx" ON "ProviderAccount"("providerId");

-- CreateIndex
CREATE INDEX "ProviderAccount_health_idx" ON "ProviderAccount"("health");

-- CreateIndex
CREATE INDEX "ProviderAccount_isActive_idx" ON "ProviderAccount"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderAccount_providerId_baseUrl_apiKeyFingerprint_key" ON "ProviderAccount"("providerId", "baseUrl", "apiKeyFingerprint");

-- CreateIndex
CREATE INDEX "ModelPricing_modelId_idx" ON "ModelPricing"("modelId");

-- CreateIndex
CREATE INDEX "ModelPricing_image2Mode_idx" ON "ModelPricing"("image2Mode");

-- CreateIndex
CREATE INDEX "ModelPricing_isActive_idx" ON "ModelPricing"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CreditRedemptionCode_code_key" ON "CreditRedemptionCode"("code");

-- CreateIndex
CREATE INDEX "CreditRedemptionCode_code_idx" ON "CreditRedemptionCode"("code");

-- CreateIndex
CREATE INDEX "CreditRedemptionCode_createdAt_idx" ON "CreditRedemptionCode"("createdAt");

-- CreateIndex
CREATE INDEX "CreditRedemption_userId_createdAt_idx" ON "CreditRedemption"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditRedemption_codeId_createdAt_idx" ON "CreditRedemption"("codeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditRedemption_codeId_userId_key" ON "CreditRedemption"("codeId", "userId");

-- CreateIndex
CREATE INDEX "UsageLog_userId_createdAt_idx" ON "UsageLog"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt" DESC);

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
ALTER TABLE "User" ADD CONSTRAINT "User_inviteCodeId_fkey" FOREIGN KEY ("inviteCodeId") REFERENCES "InviteCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "ProviderAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedImage" ADD CONSTRAINT "GeneratedImage_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAccount" ADD CONSTRAINT "ProviderAccount_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditRedemption" ADD CONSTRAINT "CreditRedemption_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "CreditRedemptionCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditRedemption" ADD CONSTRAINT "CreditRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PPTGeneration" ADD CONSTRAINT "PPTGeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PPTGeneration" ADD CONSTRAINT "PPTGeneration_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PPTSlide" ADD CONSTRAINT "PPTSlide_pptGenerationId_fkey" FOREIGN KEY ("pptGenerationId") REFERENCES "PPTGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PPTSlide" ADD CONSTRAINT "PPTSlide_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
