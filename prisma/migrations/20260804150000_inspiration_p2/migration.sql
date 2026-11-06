-- Inspiration community P2: designer profiles, named bookmark collections,
-- and durable notification read state.
ALTER TABLE "User"
ADD COLUMN "avatarKey" TEXT,
ADD COLUMN "bio" TEXT,
ADD COLUMN "designerTitle" TEXT,
ADD COLUMN "designerLocation" TEXT,
ADD COLUMN "designerWebsite" TEXT,
ADD COLUMN "designDisciplines" "Discipline"[] NOT NULL DEFAULT ARRAY[]::"Discipline"[];

CREATE TABLE "BookmarkCollection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BookmarkCollection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BookmarkCollectionItem" (
    "collectionId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BookmarkCollectionItem_pkey" PRIMARY KEY ("collectionId", "postId")
);

CREATE TABLE "InspirationNotificationRead" (
    "userId" TEXT NOT NULL,
    "notificationKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InspirationNotificationRead_pkey" PRIMARY KEY ("userId", "notificationKey")
);

CREATE UNIQUE INDEX "BookmarkCollection_userId_name_key" ON "BookmarkCollection"("userId", "name");
CREATE INDEX "BookmarkCollection_userId_updatedAt_idx" ON "BookmarkCollection"("userId", "updatedAt" DESC);
CREATE INDEX "BookmarkCollectionItem_postId_createdAt_idx" ON "BookmarkCollectionItem"("postId", "createdAt" DESC);
CREATE INDEX "InspirationNotificationRead_userId_readAt_idx" ON "InspirationNotificationRead"("userId", "readAt" DESC);

ALTER TABLE "BookmarkCollection"
ADD CONSTRAINT "BookmarkCollection_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookmarkCollectionItem"
ADD CONSTRAINT "BookmarkCollectionItem_collectionId_fkey"
FOREIGN KEY ("collectionId") REFERENCES "BookmarkCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookmarkCollectionItem"
ADD CONSTRAINT "BookmarkCollectionItem_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "DesignPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InspirationNotificationRead"
ADD CONSTRAINT "InspirationNotificationRead_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
