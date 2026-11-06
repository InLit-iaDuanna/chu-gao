import { PostStatus, TrustTier } from "@prisma/client";
import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import { adminFailureResponse, authenticatedUser, checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { adminPostActionError } from "@/lib/inspiration-admin";
import {
  postInclude,
  rankScoreForCounts,
  serializePost,
  syncTagUsageCounts,
} from "@/lib/inspiration";
import { readJsonBodySafe } from "@/lib/request-body";
import { sameOriginMutationFailure } from "@/lib/request-origin";

const schema = z.object({
  action: z.enum(["APPROVE", "HIDE", "RESTORE", "RESTRICT_AUTHOR"]),
  note: z.string().trim().max(2_000).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originFailure = sameOriginMutationFailure(request);
  if (originFailure) return originFailure;
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);
  if (failure) return failure;
  const admin = authenticatedUser(sessionResult);
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) return fail("VALIDATION_ERROR", "审核操作不合法", { status: 400 });
  const { id } = await params;
  const existing = await db.designPost.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, role: true } },
      tags: { select: { tagId: true } },
    },
  });
  if (!existing) return fail("NOT_FOUND", "帖子不存在", { status: 404 });
  if (existing.deletedAt) return fail("NOT_FOUND", "帖子不存在", { status: 404 });
  const actionError = adminPostActionError(parsed.data.action, existing.status);
  if (actionError) return fail("INVALID_STATE", actionError, { status: 409 });
  if (
    parsed.data.action === "RESTRICT_AUTHOR" &&
    (!existing.authorId || existing.author?.role === "ADMIN")
  ) {
    return fail("INVALID_TARGET", "不能限制管理员或匿名作者", { status: 400 });
  }

  const now = new Date();
  const row = await db.$transaction(async (tx) => {
    if (parsed.data.action === "RESTRICT_AUTHOR" && existing.authorId) {
      // The schema stores trust on a post rather than on User.  Marking every
      // post gives getTrustTier a durable author-level restriction marker for
      // future submissions without exposing a new user field.
      await tx.designPost.updateMany({
        where: { authorId: existing.authorId },
        data: { trustTier: TrustTier.RESTRICTED },
      });
    }

    const data =
      parsed.data.action === "APPROVE"
        ? {
            status: PostStatus.PUBLISHED,
            publishedAt: existing.publishedAt ?? now,
            hiddenAt: null,
            moderationNote: parsed.data.note ?? null,
            // Approval promotes a NEW author's future posts to automatic
            // publishing.  A restricted author remains restricted.
            trustTier:
              existing.trustTier === TrustTier.RESTRICTED
                ? TrustTier.RESTRICTED
                : TrustTier.TRUSTED,
          }
        : parsed.data.action === "RESTORE"
          ? {
              status: PostStatus.PUBLISHED,
              publishedAt: existing.publishedAt ?? now,
              hiddenAt: null,
              moderationNote: parsed.data.note ?? null,
            }
          : {
              status: PostStatus.HIDDEN,
              hiddenAt: existing.hiddenAt ?? now,
              moderationNote:
                parsed.data.note ??
                (parsed.data.action === "RESTRICT_AUTHOR"
                  ? "作者已被限制，帖子下架待复核"
                  : "管理员隐藏"),
            };

    const nextStatus = data.status;
    const publishedAt =
      nextStatus === PostStatus.PUBLISHED
        ? ("publishedAt" in data ? data.publishedAt : existing.publishedAt) ?? now
        : null;
    const updated = await tx.designPost.update({
      where: { id },
      data: {
        ...data,
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
      },
      include: postInclude,
    });

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
  if (
    existing.status === PostStatus.PUBLISHED ||
    row.status === PostStatus.PUBLISHED
  ) {
    await syncTagUsageCounts(existing.tags.map((item) => item.tagId));
  }
  await audit({
    actorId: admin.id,
    action: `admin.inspiration.${parsed.data.action.toLowerCase()}`,
    target: id,
    diff: {
      fromStatus: existing.status,
      toStatus: row.status,
      authorId: existing.authorId,
      note: parsed.data.note ?? null,
    },
    request,
  });
  return ok({
    ...serializePost(row, admin),
    trustTier: row.trustTier,
    rankScore: row.rankScore,
    moderationNote: row.moderationNote,
    hiddenAt: row.hiddenAt?.toISOString() ?? null,
  });
}
