CREATE TYPE "WishStatus" AS ENUM ('OPEN', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED');

CREATE TABLE "Wish" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorKeyHash" TEXT,
    "authorIpHash" TEXT NOT NULL,
    "userId" TEXT,
    "status" "WishStatus" NOT NULL DEFAULT 'OPEN',
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Wish_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WishComment" (
    "id" TEXT NOT NULL,
    "wishId" TEXT NOT NULL,
    "parentId" TEXT,
    "content" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorKeyHash" TEXT,
    "authorIpHash" TEXT NOT NULL,
    "userId" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WishComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WishDailyQuota" (
    "ipHash" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WishDailyQuota_pkey" PRIMARY KEY ("ipHash", "day")
);

CREATE INDEX "Wish_createdAt_idx" ON "Wish"("createdAt" DESC);
CREATE INDEX "Wish_status_createdAt_idx" ON "Wish"("status", "createdAt" DESC);
CREATE INDEX "Wish_userId_idx" ON "Wish"("userId");
CREATE INDEX "WishComment_wishId_createdAt_idx" ON "WishComment"("wishId", "createdAt");
CREATE INDEX "WishComment_parentId_idx" ON "WishComment"("parentId");
CREATE INDEX "WishComment_userId_idx" ON "WishComment"("userId");
ALTER TABLE "Wish" ADD CONSTRAINT "Wish_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WishComment" ADD CONSTRAINT "WishComment_wishId_fkey" FOREIGN KEY ("wishId") REFERENCES "Wish"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WishComment" ADD CONSTRAINT "WishComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WishComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WishComment" ADD CONSTRAINT "WishComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
