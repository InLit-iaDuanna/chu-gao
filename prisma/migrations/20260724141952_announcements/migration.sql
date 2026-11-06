-- CreateEnum
CREATE TYPE "AnnouncementTone" AS ENUM ('INFO', 'WARNING', 'SUCCESS', 'DANGER');

-- CreateEnum
CREATE TYPE "AnnouncementDisplayMode" AS ENUM ('BANNER', 'POPUP', 'BOTH');

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "tone" "AnnouncementTone" NOT NULL DEFAULT 'INFO',
    "displayMode" "AnnouncementDisplayMode" NOT NULL DEFAULT 'BANNER',
    "linkLabel" TEXT,
    "linkUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Announcement_enabled_createdAt_idx" ON "Announcement"("enabled", "createdAt" DESC);
