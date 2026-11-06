// 数据保留：聊天记录与生成图片仅保留 30 天。
// 沿用项目的软删除约定：过期的 Generation 置 deletedAt（对用户不可见、不可下载），
// 过期的 Conversation 置 archivedAt（从活跃列表移除）。不物理删除存储对象。

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const RETENTION_DAYS = 30;

export function retentionCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export interface RetentionCleanupResult {
  cutoff: string;
  generationsSoftDeleted: number;
  conversationsArchived: number;
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

  const result: RetentionCleanupResult = {
    cutoff: cutoff.toISOString(),
    generationsSoftDeleted: generations.count,
    conversationsArchived: conversations.count,
  };

  logger.info(result, "Retention cleanup completed.");
  return result;
}
