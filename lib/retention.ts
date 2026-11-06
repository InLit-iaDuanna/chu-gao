// 数据保留：聊天记录与生成图片仅保留 30 天。
// 沿用项目的软删除约定：过期的 Generation 置 deletedAt（对用户不可见、不可下载），
// 过期的 Conversation 置 archivedAt（从活跃列表移除）。不物理删除存储对象。

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  removeDesignPostSnapshots,
  removeExpiredUploadedReferences,
} from "@/lib/storage";

export const RETENTION_DAYS = 30;

export function retentionCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export interface RetentionCleanupResult {
  cutoff: string;
  generationsSoftDeleted: number;
  conversationsArchived: number;
  designPostMediaPurged: number;
  uploadedReferencesPurged: number;
}

// 清理超过保留期的数据。可由定时任务或管理员手动触发。幂等。
export async function cleanupExpiredData(
  now: Date = new Date(),
): Promise<RetentionCleanupResult> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run retention cleanup.");
  }

  const cutoff = retentionCutoff(now);

  const [generations, conversations] = await Promise.all([
    db.generation.updateMany({
      where: {
        deletedAt: null,
        createdAt: { lt: cutoff },
      },
      data: { deletedAt: now },
    }),
    db.conversation.updateMany({
      where: {
        archivedAt: null,
        lastMessageAt: { lt: cutoff },
      },
      data: { archivedAt: now },
    }),
  ]);

  const expiredPosts = await db.designPost.findMany({
    where: {
      deletedAt: { not: null, lt: cutoff },
      media: { some: { deletedAt: null } },
    },
    include: { media: { where: { deletedAt: null }, select: { storageKey: true, thumbnailKey: true } } },
    orderBy: { deletedAt: "asc" },
    take: 500,
  });
  let designPostMediaPurged = 0;
  for (const post of expiredPosts) {
    if (!post.media.length) continue;
    await removeDesignPostSnapshots(post.media);
    const updated = await db.designPostMedia.updateMany({
      where: { postId: post.id, deletedAt: null },
      data: { deletedAt: now },
    });
    designPostMediaPurged += updated.count;
  }

  const activeGenerationReferences = await db.generation.findMany({
    where: { deletedAt: null },
    select: { referenceImageKeys: true },
  });
  const uploadedReferencesPurged = await removeExpiredUploadedReferences({
    cutoff,
    protectedKeys: activeGenerationReferences.flatMap(
      (generation) => generation.referenceImageKeys,
    ),
  });

  const result: RetentionCleanupResult = {
    cutoff: cutoff.toISOString(),
    generationsSoftDeleted: generations.count,
    conversationsArchived: conversations.count,
    designPostMediaPurged,
    uploadedReferencesPurged,
  };

  logger.info(result, "Retention cleanup completed.");
  return result;
}
