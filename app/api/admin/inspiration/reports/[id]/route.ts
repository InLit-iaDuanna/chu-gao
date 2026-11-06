import { PostStatus } from "@prisma/client";
import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { rankScoreForCounts, syncTagUsageCounts } from "@/lib/inspiration";
import { readJsonBodySafe } from "@/lib/request-body";
import { sameOriginMutationFailure } from "@/lib/request-origin";

const schema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("REVIEWING"),
    resolution: z.string().trim().max(2_000).optional(),
    hideTarget: z.literal(false).default(false),
  }),
  z.object({
    status: z.literal("RESOLVED"),
    resolution: z.string().trim().min(1).max(2_000),
    hideTarget: z.literal(true),
  }),
  z.object({
    status: z.literal("DISMISSED"),
    resolution: z.string().trim().min(1).max(2_000),
    hideTarget: z.literal(false).default(false),
  }),
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originFailure = sameOriginMutationFailure(request);
  if (originFailure) return originFailure;
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);
  if (failure) return failure;
  const admin = authenticatedUser(sessionResult);
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "处理结果不合法", { status: 400 });
  const { id } = await params;
  const now = new Date();
  let affectedTagIds: string[] = [];
  const report = await db.$transaction(async (tx) => {
    const existing = await tx.contentReport.findUnique({ where: { id } });
    if (!existing) return null;

    if (parsed.data.hideTarget && existing.postId) {
      const target = await tx.designPost.findUnique({
        where: { id: existing.postId },
        select: {
          derivedFromPostId: true,
          hiddenAt: true,
          tags: { select: { tagId: true } },
        },
      });

      if (target) {
        affectedTagIds = target.tags?.map((item) => item.tagId) ?? [];
        const hidden = await tx.designPost.updateMany({
          where: { id: existing.postId, status: PostStatus.PUBLISHED },
          data: {
            status: PostStatus.HIDDEN,
            hiddenAt: target.hiddenAt ?? now,
            moderationNote: parsed.data.resolution ?? "举报处理下架",
            rankScore: 0,
          },
        });

        if (hidden.count === 0) {
          await tx.designPost.updateMany({
            where: {
              id: existing.postId,
              status: { not: PostStatus.PUBLISHED },
            },
            data: {
              status: PostStatus.HIDDEN,
              hiddenAt: target.hiddenAt ?? now,
              moderationNote: parsed.data.resolution ?? "举报处理下架",
              rankScore: 0,
            },
          });
        }

        if (hidden.count === 1 && target.derivedFromPostId) {
          await tx.designPost.updateMany({
            where: {
              id: target.derivedFromPostId,
              derivedCount: { gt: 0 },
            },
            data: { derivedCount: { decrement: 1 } },
          });
          const parent = await tx.designPost.findUnique({
            where: { id: target.derivedFromPostId },
            select: {
              id: true,
              likeCount: true,
              bookmarkCount: true,
              commentCount: true,
              derivedCount: true,
              publishedAt: true,
            },
          });
          if (parent) {
            await tx.designPost.update({
              where: { id: parent.id },
              data: {
                rankScore: rankScoreForCounts({
                  likes: parent.likeCount,
                  bookmarks: parent.bookmarkCount,
                  comments: parent.commentCount,
                  derived: parent.derivedCount,
                  publishedAt: parent.publishedAt,
                }),
              },
            });
          }
        }
      }
    }

    if (parsed.data.hideTarget && existing.commentId) {
      const target = await tx.postComment.findUnique({
        where: { id: existing.commentId },
        select: { postId: true, deletedAt: true },
      });
      if (target && !target.deletedAt) {
        const deleted = await tx.postComment.updateMany({
          where: { id: existing.commentId, deletedAt: null },
          // Keep the original text as moderation evidence. Public serializers
          // replace deleted content and author identity with tombstone text.
          data: { deletedAt: now },
        });
        if (deleted.count === 1) {
          await tx.designPost.updateMany({
            where: { id: target.postId, commentCount: { gt: 0 } },
            data: { commentCount: { decrement: 1 } },
          });
          const post = await tx.designPost.findUnique({
            where: { id: target.postId },
            select: {
              id: true,
              likeCount: true,
              bookmarkCount: true,
              commentCount: true,
              derivedCount: true,
              publishedAt: true,
            },
          });
          if (post) {
            await tx.designPost.update({
              where: { id: post.id },
              data: {
                rankScore: rankScoreForCounts({
                  likes: post.likeCount,
                  bookmarks: post.bookmarkCount,
                  comments: post.commentCount,
                  derived: post.derivedCount,
                  publishedAt: post.publishedAt,
                }),
              },
            });
          }
        }
      }
    }

    return tx.contentReport.update({
      where: { id },
      data: {
        status: parsed.data.status,
        resolution: parsed.data.resolution ?? null,
        reviewerId: admin.id,
        reviewedAt: now,
      },
    });
  });
  if (!report) return fail("NOT_FOUND", "举报不存在", { status: 404 });
  if (affectedTagIds.length) await syncTagUsageCounts(affectedTagIds);
  await audit({
    actorId: admin.id,
    action: "admin.inspiration.report.review",
    target: id,
    diff: parsed.data,
    request,
  });
  return ok(report);
}
