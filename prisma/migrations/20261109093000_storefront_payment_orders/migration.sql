-- CreateEnum
CREATE TYPE "StorefrontOrderStatus" AS ENUM ('PENDING', 'PAID', 'COMPLETED', 'EXPIRED', 'FAILED');

-- CreateTable
CREATE TABLE "StorefrontOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "contact" TEXT NOT NULL,
    "queryPasswordHash" TEXT NOT NULL,
    "queryPasswordEncrypted" TEXT NOT NULL,
    "payUrl" TEXT,
    "externalTradeNo" TEXT,
    "externalProductId" TEXT,
    "externalAmount" DECIMAL(12,2),
    "status" "StorefrontOrderStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "redemptionCodeId" TEXT,
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorefrontOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontOrder_externalTradeNo_key" ON "StorefrontOrder"("externalTradeNo");
CREATE UNIQUE INDEX "StorefrontOrder_redemptionCodeId_key" ON "StorefrontOrder"("redemptionCodeId");
CREATE INDEX "StorefrontOrder_userId_createdAt_idx" ON "StorefrontOrder"("userId", "createdAt");
CREATE INDEX "StorefrontOrder_status_expiresAt_idx" ON "StorefrontOrder"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "StorefrontOrder" ADD CONSTRAINT "StorefrontOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorefrontOrder" ADD CONSTRAINT "StorefrontOrder_redemptionCodeId_fkey" FOREIGN KEY ("redemptionCodeId") REFERENCES "CreditRedemptionCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
