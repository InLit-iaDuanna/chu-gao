// 数据保留：聊天记录与生成图片仅保留 30 天。
// 沿用项目的软删除约定：过期的 Generation 置 deletedAt（对用户不可见、不可下载），
// 过期的 Conversation 置 archivedAt（从活跃列表移除）。不物理删除存储对象。
//
// 例外：LOCAL 对话（安卓 APP 内默认只保存在本机的对话）在服务器上只是工作副本，
// 完整记录保存在手机本地。闲置 7 天后直接归档并清空 ConversationMessage 内容。

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  removeDesignPostSnapshots,
  removeExpiredUploadedReferences,
} from "@/lib/storage";

export const RETENTION_DAYS = 30;

/** LOCAL 对话工作副本的闲置天数。 */
export const LOCAL_CONVERSATION_RETENTION_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const LOCAL_CONVERSATION_BATCH = 500;

export function retentionCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
}

export function localConversationRetentionCutoff(
  now: Date = new Date(),
): Date {
  return new Date(now.getTime() - LOCAL_CONVERSATION_RETENTION_DAYS * DAY_MS);
}

export interface RetentionCleanupResult {
  cutoff: string;
  generationsSoftDeleted: number;
  conversationsArchived: number;
  localConversationsPurged: number;
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
  const localCutoff = localConversationRetentionCutoff(now);

  // 闲置的 LOCAL 对话先处理：归档并删除服务器上的消息副本。
  // 手机本地快照不受影响，用户仍可在设备上查看完整记录。
  const idleLocal = await db.conversation.findMany({
    where: {
      storage: "LOCAL",
      archivedAt: null,
      lastMessageAt: { lt: localCutoff },
    },
    select: { id: true },
    orderBy: { lastMessageAt: "asc" },
    take: LOCAL_CONVERSATION_BATCH,
  });
  let localConversationsPurged = 0;
  for (const conversation of idleLocal) {
    const [, removed] = await db.$transaction([
      db.conversation.updateMany({
        where: { id: conversation.id, archivedAt: null },
        data: { archivedAt: now },
      }),
      db.conversationMessage.deleteMany({
        where: { conversationId: conversation.id },
      }),
    ]);
    localConversationsPurged += removed.count;
  }

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
    localConversationsPurged,
    designPostMediaPurged,
    uploadedReferencesPurged,
  };

  logger.info(result, "Retention cleanup completed.");
  return result;
}
