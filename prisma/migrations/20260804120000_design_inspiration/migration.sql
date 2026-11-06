-- Design inspiration community foundation.
CREATE TYPE "PostShape" AS ENUM ('WORK', 'TEARDOWN', 'PATTERN', 'QUESTION', 'REFERENCE', 'PROCESS');
CREATE TYPE "Discipline" AS ENUM ('GRAPHIC', 'PRODUCT', 'INDUSTRIAL', 'SERVICE', 'SPATIAL', 'BRAND', 'MOTION', 'DATAVIZ');
CREATE TYPE "PostStatus" AS ENUM ('DRAFT', 'PENDING', 'PUBLISHED', 'HIDDEN');
CREATE TYPE "PostOrigin" AS ENUM ('ORIGINAL', 'STUDY', 'REPOST');
CREATE TYPE "PromptVisibility" AS ENUM ('PUBLIC', 'STRUCTURE_ONLY', 'PRIVATE');
CREATE TYPE "MediaRole" AS ENUM ('FINAL', 'PROCESS');
CREATE TYPE "TagKind" AS ENUM ('CATEGORY', 'STYLE');
CREATE TYPE "TrustTier" AS ENUM ('NEW', 'TRUSTED', 'RESTRICTED');
CREATE TYPE "FollowTargetType" AS ENUM ('USER', 'DISCIPLINE', 'TAG');
CREATE TYPE "ContentReportStatus" AS ENUM ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED');
CREATE TYPE "ContentReportReason" AS ENUM ('COPYRIGHT', 'HARASSMENT', 'SPAM', 'NSFW', 'MISINFORMATION', 'OTHER');
CREATE TYPE "DailyPromptStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "DesignPost" (
    "id" TEXT NOT NULL,
    "authorId" TEXT,
    "authorNameSnapshot" TEXT NOT NULL,
    "shape" "PostShape" NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "title" TEXT NOT NULL,
    "story" TEXT,
    "origin" "PostOrigin" NOT NULL DEFAULT 'ORIGINAL',
    "externalUrl" TEXT,
    "sourceNote" TEXT,
    "promptVisibility" "PromptVisibility" NOT NULL DEFAULT 'STRUCTURE_ONLY',
    "status" "PostStatus" NOT NULL DEFAULT 'PENDING',
    "trustTier" "TrustTier" NOT NULL DEFAULT 'NEW',
    "moderationNote" TEXT,
    "derivedFromPostId" TEXT,
    "dailyPromptId" TEXT,
    "hasMedia" BOOLEAN NOT NULL DEFAULT false,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "bookmarkCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "derivedCount" INTEGER NOT NULL DEFAULT 0,
    "rankScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DesignPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DesignPostMedia" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "role" "MediaRole" NOT NULL DEFAULT 'FINAL',
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "sourceGeneratedImageId" TEXT,
    "recipe" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "DesignPostMedia_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PostLike" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "countsForRank" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostLike_pkey" PRIMARY KEY ("postId", "userId")
);

CREATE TABLE "PostBookmark" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "countsForRank" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostBookmark_pkey" PRIMARY KEY ("postId", "userId")
);

CREATE TABLE "PostComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "parentId" TEXT,
    "authorId" TEXT,
    "authorNameSnapshot" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "PostComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DesignTag" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TagKind" NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DesignTag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PostTag" (
    "postId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    CONSTRAINT "PostTag_pkey" PRIMARY KEY ("postId", "tagId")
);

CREATE TABLE "UserFollow" (
    "id" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "targetType" "FollowTargetType" NOT NULL,
    "targetKey" TEXT NOT NULL,
    "targetUserId" TEXT,
    "discipline" "Discipline",
    "tagId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserFollow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyPrompt" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "keywords" TEXT[] NOT NULL,
    "status" "DailyPromptStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "questionPostId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DailyPrompt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyPromptFeature" (
    "dailyPromptId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyPromptFeature_pkey" PRIMARY KEY ("dailyPromptId", "postId")
);

CREATE TABLE "ContentReport" (
    "id" TEXT NOT NULL,
    "postId" TEXT,
    "commentId" TEXT,
    "reporterId" TEXT,
    "reason" "ContentReportReason" NOT NULL,
    "note" TEXT,
    "status" "ContentReportStatus" NOT NULL DEFAULT 'OPEN',
    "reviewerId" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    CONSTRAINT "ContentReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PostDailyQuota" (
    "ipHash" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PostDailyQuota_pkey" PRIMARY KEY ("ipHash", "day")
);

CREATE UNIQUE INDEX "DesignTag_slug_key" ON "DesignTag"("slug");
CREATE UNIQUE INDEX "DailyPrompt_questionPostId_key" ON "DailyPrompt"("questionPostId");
CREATE UNIQUE INDEX "UserFollow_followerId_targetType_targetKey_key" ON "UserFollow"("followerId", "targetType", "targetKey");
CREATE INDEX "DesignPost_status_rankScore_idx" ON "DesignPost"("status", "rankScore" DESC);
CREATE INDEX "DesignPost_discipline_status_rankScore_idx" ON "DesignPost"("discipline", "status", "rankScore" DESC);
CREATE INDEX "DesignPost_status_publishedAt_idx" ON "DesignPost"("status", "publishedAt" DESC);
CREATE INDEX "DesignPost_authorId_createdAt_idx" ON "DesignPost"("authorId", "createdAt" DESC);
CREATE INDEX "DesignPost_shape_status_publishedAt_idx" ON "DesignPost"("shape", "status", "publishedAt" DESC);
CREATE INDEX "DesignPost_dailyPromptId_idx" ON "DesignPost"("dailyPromptId");
CREATE INDEX "DesignPost_derivedFromPostId_idx" ON "DesignPost"("derivedFromPostId");
CREATE INDEX "DesignPost_deletedAt_idx" ON "DesignPost"("deletedAt");
CREATE INDEX "DesignPostMedia_postId_order_idx" ON "DesignPostMedia"("postId", "order");
CREATE INDEX "DesignPostMedia_postId_isCover_idx" ON "DesignPostMedia"("postId", "isCover");
CREATE INDEX "DesignPostMedia_sourceGeneratedImageId_idx" ON "DesignPostMedia"("sourceGeneratedImageId");
CREATE INDEX "DesignPostMedia_deletedAt_idx" ON "DesignPostMedia"("deletedAt");
CREATE INDEX "PostLike_userId_createdAt_idx" ON "PostLike"("userId", "createdAt" DESC);
CREATE INDEX "PostLike_postId_countsForRank_idx" ON "PostLike"("postId", "countsForRank");
CREATE INDEX "PostBookmark_userId_createdAt_idx" ON "PostBookmark"("userId", "createdAt" DESC);
CREATE INDEX "PostBookmark_postId_countsForRank_idx" ON "PostBookmark"("postId", "countsForRank");
CREATE INDEX "PostComment_postId_createdAt_idx" ON "PostComment"("postId", "createdAt");
CREATE INDEX "PostComment_parentId_idx" ON "PostComment"("parentId");
CREATE INDEX "PostComment_authorId_idx" ON "PostComment"("authorId");
CREATE INDEX "PostComment_deletedAt_idx" ON "PostComment"("deletedAt");
CREATE INDEX "DesignTag_kind_usageCount_idx" ON "DesignTag"("kind", "usageCount" DESC);
CREATE INDEX "DesignTag_name_idx" ON "DesignTag"("name");
CREATE INDEX "PostTag_tagId_postId_idx" ON "PostTag"("tagId", "postId");
CREATE INDEX "UserFollow_targetType_targetKey_createdAt_idx" ON "UserFollow"("targetType", "targetKey", "createdAt" DESC);
CREATE INDEX "UserFollow_followerId_createdAt_idx" ON "UserFollow"("followerId", "createdAt" DESC);
CREATE INDEX "UserFollow_targetUserId_idx" ON "UserFollow"("targetUserId");
CREATE INDEX "UserFollow_tagId_idx" ON "UserFollow"("tagId");
CREATE INDEX "DailyPrompt_day_idx" ON "DailyPrompt"("day");
CREATE INDEX "DailyPrompt_status_day_idx" ON "DailyPrompt"("status", "day");
CREATE INDEX "DailyPrompt_discipline_day_idx" ON "DailyPrompt"("discipline", "day");
CREATE INDEX "DailyPromptFeature_dailyPromptId_order_idx" ON "DailyPromptFeature"("dailyPromptId", "order");
CREATE INDEX "ContentReport_status_createdAt_idx" ON "ContentReport"("status", "createdAt" DESC);
CREATE INDEX "ContentReport_postId_createdAt_idx" ON "ContentReport"("postId", "createdAt" DESC);
CREATE INDEX "ContentReport_commentId_createdAt_idx" ON "ContentReport"("commentId", "createdAt" DESC);
CREATE INDEX "ContentReport_reporterId_createdAt_idx" ON "ContentReport"("reporterId", "createdAt" DESC);

ALTER TABLE "DesignPost" ADD CONSTRAINT "DesignPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DesignPost" ADD CONSTRAINT "DesignPost_derivedFromPostId_fkey" FOREIGN KEY ("derivedFromPostId") REFERENCES "DesignPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DesignPost" ADD CONSTRAINT "DesignPost_dailyPromptId_fkey" FOREIGN KEY ("dailyPromptId") REFERENCES "DailyPrompt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DesignPostMedia" ADD CONSTRAINT "DesignPostMedia_postId_fkey" FOREIGN KEY ("postId") REFERENCES "DesignPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DesignPostMedia" ADD CONSTRAINT "DesignPostMedia_sourceGeneratedImageId_fkey" FOREIGN KEY ("sourceGeneratedImageId") REFERENCES "GeneratedImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_postId_fkey" FOREIGN KEY ("postId") REFERENCES "DesignPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostBookmark" ADD CONSTRAINT "PostBookmark_postId_fkey" FOREIGN KEY ("postId") REFERENCES "DesignPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostBookmark" ADD CONSTRAINT "PostBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "DesignPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PostComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PostTag" ADD CONSTRAINT "PostTag_postId_fkey" FOREIGN KEY ("postId") REFERENCES "DesignPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostTag" ADD CONSTRAINT "PostTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "DesignTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserFollow" ADD CONSTRAINT "UserFollow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserFollow" ADD CONSTRAINT "UserFollow_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserFollow" ADD CONSTRAINT "UserFollow_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "DesignTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyPrompt" ADD CONSTRAINT "DailyPrompt_questionPostId_fkey" FOREIGN KEY ("questionPostId") REFERENCES "DesignPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DailyPromptFeature" ADD CONSTRAINT "DailyPromptFeature_dailyPromptId_fkey" FOREIGN KEY ("dailyPromptId") REFERENCES "DailyPrompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyPromptFeature" ADD CONSTRAINT "DailyPromptFeature_postId_fkey" FOREIGN KEY ("postId") REFERENCES "DesignPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_postId_fkey" FOREIGN KEY ("postId") REFERENCES "DesignPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "PostComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
