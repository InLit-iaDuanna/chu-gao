-- CreateEnum
CREATE TYPE "SessionDeviceType" AS ENUM ('WEB', 'MOBILE', 'IPAD');

-- CreateTable
CREATE TABLE "DeviceSession" (
    "userId" TEXT NOT NULL,
    "deviceType" "SessionDeviceType" NOT NULL,
    "deviceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceSession_pkey" PRIMARY KEY ("userId", "deviceType")
);

-- CreateIndex
CREATE INDEX "DeviceSession_deviceId_idx" ON "DeviceSession"("deviceId");

-- CreateIndex
CREATE INDEX "DeviceSession_expiresAt_idx" ON "DeviceSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "DeviceSession" ADD CONSTRAINT "DeviceSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
