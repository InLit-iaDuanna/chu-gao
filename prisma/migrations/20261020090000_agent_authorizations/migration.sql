CREATE TABLE "AgentAuthorization" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "tokenHash" TEXT,
    "sessionVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "boundGenerationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentAuthorization_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AgentAuthorization_mode_check" CHECK ("mode" IN ('single', 'timed'))
);
CREATE TABLE "AgentDeviceAuthorization" (
    "id" TEXT NOT NULL,
    "deviceCodeHash" TEXT NOT NULL,
    "userCodeHash" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastPolledAt" TIMESTAMP(3),
    "pollInterval" INTEGER NOT NULL DEFAULT 5,
    "authorizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentDeviceAuthorization_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AgentDeviceAuthorization_status_check" CHECK ("status" IN ('pending', 'approved', 'denied', 'consumed'))
);
CREATE UNIQUE INDEX "AgentAuthorization_tokenHash_key" ON "AgentAuthorization"("tokenHash");
CREATE INDEX "AgentAuthorization_userId_createdAt_idx" ON "AgentAuthorization"("userId", "createdAt" DESC);
CREATE INDEX "AgentAuthorization_expiresAt_idx" ON "AgentAuthorization"("expiresAt");
CREATE UNIQUE INDEX "AgentDeviceAuthorization_deviceCodeHash_key" ON "AgentDeviceAuthorization"("deviceCodeHash");
CREATE UNIQUE INDEX "AgentDeviceAuthorization_userCodeHash_key" ON "AgentDeviceAuthorization"("userCodeHash");
CREATE UNIQUE INDEX "AgentDeviceAuthorization_authorizationId_key" ON "AgentDeviceAuthorization"("authorizationId");
CREATE INDEX "AgentDeviceAuthorization_expiresAt_idx" ON "AgentDeviceAuthorization"("expiresAt");
ALTER TABLE "AgentAuthorization" ADD CONSTRAINT "AgentAuthorization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentDeviceAuthorization" ADD CONSTRAINT "AgentDeviceAuthorization_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "AgentAuthorization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Generation" ADD COLUMN "agentAuthorizationId" TEXT;
CREATE INDEX "Generation_agentAuthorizationId_idx" ON "Generation"("agentAuthorizationId");
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_agentAuthorizationId_fkey" FOREIGN KEY ("agentAuthorizationId") REFERENCES "AgentAuthorization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
