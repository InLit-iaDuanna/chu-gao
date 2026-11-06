import { PostStatus, TrustTier } from "@prisma/client";
import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { authorPostStatusError } from "@/lib/inspiration-admin";
import {
  getTrustTier,
  httpUrlSchema,
  postInclude,
  rankScoreForCounts,
  serializePost,
  ensureTags,
  syncTagUsageCounts,
} from "@/lib/inspiration";
import { isInspirationTextBlocked } from "@/lib/inspiration-moderation";
import { ModerationRejectionLimitError } from "@/lib/rate-limit";
import { readJsonBodySafe } from "@/lib/request-body";

const updateSchema = z
  .object({
    title: z.string().trim().min(2).max(120).optional(),
    story: z.string().trim().max(10_000).nullable().optional(),
    shape: z
      .enum(["WORK", "TEARDOWN", "PATTERN", "QUESTION", "REFERENCE", "PROCESS"])
      .optional(),
    discipline: z
      .enum([
        "GRAPHIC",
        "PRODUCT",
        "INDUSTRIAL",
        "SERVICE",
        "SPATIAL",
        "BRAND",
        "MOTION",
        "DATAVIZ",
      ])
      .optional(),
    origin: z.enum(["ORIGINAL", "STUDY", "REPOST"]).optional(),
    externalUrl: httpUrlSchema.nullable().optional(),
    sourceNote: z.string().trim().max(3_000).nullable().optional(),
    promptVisibility: z
      .enum(["PUBLIC", "STRUCTURE_ONLY", "PRIVATE"])
      .optional(),
    tags: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
    status: z.enum(["DRAFT", "PENDING", "PUBLISHED", "HIDDEN"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sessionResult = await checkSession(request);
  const viewer =
    sessionResult.status === "authenticated" ? sessionResult.user : null;
  const row = await db.designPost.findUnique({
    where: { id },
    include: postInclude,
  });
  if (!row || row.deletedAt)
    return fail("NOT_FOUND", "帖子不存在", { status: 404 });
  const canPreview =
    viewer && (viewer.id === row.authorId || viewer.role === "ADMIN");
  if (row.status !== PostStatus.PUBLISHED && !canPreview)
    return fail("NOT_FOUND", "帖子不存在", { status: 404 });

  const [like, bookmark, following, followedTags] = viewer
    ? await Promise.all([
        db.postLike.findUnique({
          where: { postId_userId: { postId: id, userId: viewer.id } },
        }),
        db.postBookmark.findUnique({
          where: { postId_userId: { postId: id, userId: viewer.id } },
        }),
        row.authorId
          ? db.userFollow.findUnique({
              where: {
                followerId_targetType_targetKey: {
                  followerId: viewer.id,
                  targetType: "USER",
                  targetKey: row.authorId,
                },
              },
            })
          : Promise.resolve(null),
        db.userFollow.findMany({
          where: {
            followerId: viewer.id,
            targetType: "TAG",
            targetKey: { in: row.tags.map(({ tag }) => tag.id) },
          },
          select: { targetKey: true },
        }),
      ])
    : [null, null, null, []];
  const serialized = serializePost(row, viewer);
  const followedTagIds = new Set(followedTags.map((item) => item.targetKey));
  return ok({
    ...serialized,
    tags: serialized.tags.map((tag) => ({
      ...tag,
      isFollowing: followedTagIds.has(tag.id),
    })),
    viewer: {
      ...serialized.viewer,
      isLiked: Boolean(like),
      isBookmarked: Boolean(bookmark),
      isFollowingAuthor: Boolean(following),
    },
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated")
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const { id } = await params;
  const existing = await db.designPost.findUnique({
    where: { id },
    include: {
      media: { where: { deletedAt: null }, select: { id: true } },
      tags: { select: { tagId: true } },
    },
  });
  if (!existing || existing.deletedAt)
    return fail("NOT_FOUND", "帖子不存在", { status: 404 });
  const canEdit = existing.authorId === sessionResult.user.id;
  if (!canEdit) return fail("FORBIDDEN", "你不能修改这条帖子", { status: 403 });

  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = updateSchema.safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "修改内容不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  let nextStatus = parsed.data.status ?? existing.status;
  let currentTrustTier: TrustTier | undefined;
  const isDraftSubmission =
    existing.status === PostStatus.DRAFT &&
    (parsed.data.status === PostStatus.PENDING ||
      parsed.data.status === PostStatus.PUBLISHED);

  if (sessionResult.user.role === "ADMIN") {
    if (isDraftSubmission) nextStatus = PostStatus.PUBLISHED;
  } else {
    currentTrustTier = await getTrustTier(sessionResult.user.id);
    if (isDraftSubmission) {
      nextStatus =
        currentTrustTier === TrustTier.TRUSTED
          ? PostStatus.PUBLISHED
          : PostStatus.PENDING;
    } else if (
      existing.status === PostStatus.PUBLISHED &&
      currentTrustTier === TrustTier.RESTRICTED
    ) {
      // Once an author is restricted, edits to already-public content must be
      // reviewed again instead of silently changing the public post in place.
      nextStatus = PostStatus.PENDING;
    } else if (parsed.data.status) {
      const transitionError = authorPostStatusError({
        current: existing.status,
        requested: parsed.data.status,
        trustTier: currentTrustTier,
      });
      if (transitionError) {
        return fail("FORBIDDEN", transitionError, { status: 403 });
      }
    }
  }
  try {
    if (
      await isInspirationTextBlocked({
        request,
        user: sessionResult.user,
        text: [
          parsed.data.title,
          parsed.data.story,
          parsed.data.sourceNote,
          ...(parsed.data.tags ?? []),
        ]
          .filter(Boolean)
          .join("\n"),
        surface: "POST_EDIT",
      })
    ) {
      return fail("CONTENT_BLOCKED", "内容包含不适合公开发布的信息", {
        status: 400,
      });
    }
  } catch (error) {
    if (error instanceof ModerationRejectionLimitError) {
      return fail("RATE_LIMITED", error.message, { status: 429 });
    }
    throw error;
  }

  const nextExternalUrl =
    parsed.data.externalUrl !== undefined
      ? parsed.data.externalUrl
      : existing.externalUrl;
  const nextSourceNote =
    parsed.data.sourceNote !== undefined
      ? parsed.data.sourceNote
      : existing.sourceNote;
  const nextShape = parsed.data.shape ?? existing.shape;
  const nextOrigin = parsed.data.origin ?? existing.origin;
  if (
    nextStatus !== PostStatus.DRAFT &&
    nextShape === "WORK" &&
    existing.media.length === 0
  ) {
    return fail("VALIDATION_ERROR", "作品必须包含图片", { status: 400 });
  }
  if (
    nextStatus !== PostStatus.DRAFT &&
    nextShape === "PROCESS" &&
    existing.media.length < 2
  ) {
    return fail("VALIDATION_ERROR", "过程帖子至少需要两张图", { status: 400 });
  }
  if (
    nextStatus !== PostStatus.DRAFT &&
    nextShape === "REFERENCE" &&
    (!nextExternalUrl || !nextSourceNote)
  ) {
    return fail("VALIDATION_ERROR", "参考帖子需要同时填写外链和来源说明", {
      status: 400,
    });
  }
  if (nextShape === "REFERENCE" && existing.media.length > 0) {
    return fail("VALIDATION_ERROR", "参考帖子不能附带站内图片", {
      status: 400,
    });
  }
  if (
    nextStatus !== PostStatus.DRAFT &&
    nextOrigin === "REPOST" &&
    !nextExternalUrl &&
    !nextSourceNote
  ) {
    return fail("VALIDATION_ERROR", "转载内容需要填写来源", { status: 400 });
  }

  const tagRows = parsed.data.tags ? await ensureTags(parsed.data.tags) : null;
  const transactionRow = await db.$transaction(async (tx) => {
    const publishedAt =
      nextStatus === PostStatus.PUBLISHED
        ? (existing.publishedAt ?? new Date())
        : existing.publishedAt;
    const updated = await tx.designPost.update({
      where: { id },
      data: {
        title: parsed.data.title,
        story: parsed.data.story,
        shape: parsed.data.shape,
        discipline: parsed.data.discipline,
        origin: parsed.data.origin,
        externalUrl: parsed.data.externalUrl,
        sourceNote: parsed.data.sourceNote,
        promptVisibility: parsed.data.promptVisibility,
        status: nextStatus,
        trustTier: currentTrustTier,
        publishedAt,
        rankScore:
          nextStatus === PostStatus.PUBLISHED
            ? rankScoreForCounts({
                likes: existing.likeCount,
                bookmarks: existing.bookmarkCount,
                comments: existing.commentCount,
                derived: existing.derivedCount,
                publishedAt,
              })
            : 0,
        hiddenAt:
          nextStatus === PostStatus.HIDDEN
            ? (existing.hiddenAt ?? new Date())
            : nextStatus === PostStatus.PUBLISHED
              ? null
              : undefined,
      },
      include: postInclude,
    });

    if (tagRows) {
      await tx.postTag.deleteMany({ where: { postId: id } });
      if (tagRows.length) {
        await tx.postTag.createMany({
          data: tagRows.map((tag) => ({ postId: id, tagId: tag.id })),
          skipDuplicates: true,
        });
      }
    }

    if (existing.derivedFromPostId && existing.status !== nextStatus) {
      const becamePublic =
        existing.status !== PostStatus.PUBLISHED &&
        nextStatus === PostStatus.PUBLISHED;
      const becamePrivate =
        existing.status === PostStatus.PUBLISHED &&
        nextStatus !== PostStatus.PUBLISHED;
      if (becamePublic || becamePrivate) {
        const parent = await tx.designPost.findUnique({
          where: { id: existing.derivedFromPostId },
          select: {
            id: true,
            derivedCount: true,
            likeCount: true,
            bookmarkCount: true,
            commentCount: true,
            publishedAt: true,
          },
        });
        if (parent) {
          const derived = Math.max(
            0,
            parent.derivedCount + (becamePublic ? 1 : -1),
          );
          await tx.designPost.update({
            where: { id: parent.id },
            data: {
              derivedCount: derived,
              rankScore: rankScoreForCounts({
                likes: parent.likeCount,
                bookmarks: parent.bookmarkCount,
                comments: parent.commentCount,
                derived,
                publishedAt: parent.publishedAt,
              }),
            },
          });
        }
      }
    }
    return updated;
  });
  const visibilityChanged =
    existing.status === PostStatus.PUBLISHED ||
    nextStatus === PostStatus.PUBLISHED;
  if (tagRows || visibilityChanged) {
    const affectedTagIds = Array.from(
      new Set([
        ...existing.tags.map((item) => item.tagId),
        ...(tagRows ?? []).map((item) => item.id),
      ]),
    );
    await syncTagUsageCounts(affectedTagIds);
  }
  const row = tagRows
    ? await db.designPost.findUnique({ where: { id }, include: postInclude })
    : transactionRow;
  if (!row) return fail("NOT_FOUND", "帖子不存在", { status: 404 });
  return ok(serializePost(row, sessionResult.user));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated")
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const { id } = await params;
  const existing = await db.designPost.findUnique({
    where: { id },
    include: { tags: { select: { tagId: true } } },
  });
  if (!existing || existing.deletedAt)
    return fail("NOT_FOUND", "帖子不存在", { status: 404 });
  if (existing.authorId !== sessionResult.user.id) {
    return fail("FORBIDDEN", "你不能删除这条帖子", { status: 403 });
  }
  await db.$transaction(async (tx) => {
    await tx.designPost.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: PostStatus.HIDDEN,
        hiddenAt: new Date(),
        rankScore: 0,
      },
    });
    if (
      existing.derivedFromPostId &&
      existing.status === PostStatus.PUBLISHED
    ) {
      const parent = await tx.designPost.findUnique({
        where: { id: existing.derivedFromPostId },
        select: {
          id: true,
          derivedCount: true,
          likeCount: true,
          bookmarkCount: true,
          commentCount: true,
          publishedAt: true,
        },
      });
      if (parent) {
        const derived = Math.max(0, parent.derivedCount - 1);
        await tx.designPost.update({
          where: { id: parent.id },
          data: {
            derivedCount: derived,
            rankScore: rankScoreForCounts({
              likes: parent.likeCount,
              bookmarks: parent.bookmarkCount,
              comments: parent.commentCount,
              derived,
              publishedAt: parent.publishedAt,
            }),
          },
        });
      }
    }
  });
  if (existing.status === PostStatus.PUBLISHED) {
    await syncTagUsageCounts(existing.tags.map((item) => item.tagId));
  }
  return ok({ deleted: true, mediaRetentionDays: 30 });
}
