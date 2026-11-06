import { DailyPromptStatus, PostStatus, TrustTier } from "@prisma/client";

export type AdminPostAction =
  | "APPROVE"
  | "HIDE"
  | "RESTORE"
  | "RESTRICT_AUTHOR";

export function adminPostActionError(
  action: AdminPostAction,
  status: PostStatus,
): string | null {
  if (action === "APPROVE" && status !== PostStatus.PENDING) {
    return "只有待审核帖子可以通过审核";
  }
  if (
    action === "HIDE" &&
    status !== PostStatus.PENDING &&
    status !== PostStatus.PUBLISHED
  ) {
    return "只有待审核或已发布帖子可以隐藏";
  }
  if (action === "RESTORE" && status !== PostStatus.HIDDEN) {
    return "只有已隐藏帖子可以恢复";
  }
  return null;
}

export function authorPostStatusError({
  current,
  requested,
  trustTier,
}: {
  current: PostStatus;
  requested: PostStatus;
  trustTier: TrustTier;
}): string | null {
  if (current === requested) return null;
  if (current === PostStatus.HIDDEN) {
    return "管理员隐藏的帖子不能自行恢复";
  }
  if (requested === PostStatus.HIDDEN) {
    return "作者不能直接隐藏帖子，请使用删除功能";
  }

  if (current === PostStatus.DRAFT) {
    if (requested === PostStatus.PENDING) return null;
    if (requested === PostStatus.PUBLISHED && trustTier === TrustTier.TRUSTED) {
      return null;
    }
    if (requested === PostStatus.PUBLISHED) {
      return "当前账号发布内容需要先提交审核";
    }
    return "草稿状态修改不合法";
  }

  if (current === PostStatus.PENDING && requested === PostStatus.DRAFT) {
    return null;
  }
  if (current === PostStatus.PENDING) {
    return "待审核帖子不能自行通过审核";
  }

  return "已发布帖子不能直接切换为其他状态";
}

export function parseDailyPromptDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === value ? date : null;
}

export function normalizeFeaturePostIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

export function dailyQuestionPostStatus(status: DailyPromptStatus): PostStatus {
  return status === DailyPromptStatus.PUBLISHED
    ? PostStatus.PUBLISHED
    : PostStatus.HIDDEN;
}

export function canAutomaticallyPublishDailyQuestion<
  T extends { deletedAt: Date | null; moderationNote: string | null },
>(post: T | null | undefined): post is T {
  return Boolean(post && !post.deletedAt && !post.moderationNote);
}
