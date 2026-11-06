import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getTrustTier, rankScoreForCounts } from "@/lib/inspiration";
import { readJsonBodySafe } from "@/lib/request-body";

const itemSchema = z.object({ postId: z.string().min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated") return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const rateLimit = await userActionRateLimitResponse(
    sessionResult.user.id,
    "inspiration-bookmark-collection-item",
    undefined,
    60,
  );
  if (rateLimit) return rateLimit;
  const { id: collectionId } = await params;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = itemSchema.safeParse(body.data);
  if (!parsed.success) return fail("VALIDATION_ERROR", "帖子参数不合法", { status: 400 });

  const countsForRank =
    (await getTrustTier(sessionResult.user.id)) === "TRUSTED";
  const result = await db.$transaction(async (tx) => {
    const collection = await tx.bookmarkCollection.findFirst({ where: { id: collectionId, userId: sessionResult.user.id }, select: { id: true } });
    if (!collection) return { missing: "collection" as const };
    const post = await tx.designPost.findFirst({ where: { id: parsed.data.postId, status: "PUBLISHED", deletedAt: null }, select: { id: true, likeCount: true, bookmarkCount: true, commentCount: true, derivedCount: true, publishedAt: true } });
    if (!post) return { missing: "post" as const };

    const bookmark = await tx.postBookmark.findUnique({ where: { postId_userId: { postId: post.id, userId: sessionResult.user.id } } });
    if (!bookmark) {
      await tx.postBookmark.create({ data: { postId: post.id, userId: sessionResult.user.id, countsForRank } });
      await tx.designPost.update({ where: { id: post.id }, data: { bookmarkCount: { increment: 1 } } });
      const [rankLikes, rankBookmarks] = await Promise.all([
        tx.postLike.count({ where: { postId: post.id, countsForRank: true } }),
        tx.postBookmark.count({ where: { postId: post.id, countsForRank: true } }),
      ]);
      await tx.designPost.update({
        where: { id: post.id },
        data: {
          rankScore: rankScoreForCounts({
            likes: rankLikes,
            bookmarks: rankBookmarks,
            comments: post.commentCount,
            derived: post.derivedCount,
            publishedAt: post.publishedAt,
          }),
        },
      });
    }
    const item = await tx.bookmarkCollectionItem.upsert({
      where: { collectionId_postId: { collectionId, postId: post.id } },
      create: { collectionId, postId: post.id },
      update: {},
      select: { collectionId: true, postId: true, createdAt: true },
    });
    return { item };
  });
  if ("missing" in result) return fail(result.missing === "collection" ? "NOT_FOUND" : "POST_NOT_FOUND", result.missing === "collection" ? "收藏夹不存在" : "帖子不存在或已下架", { status: 404 });
  return ok({ item: { ...result.item, createdAt: result.item.createdAt.toISOString() } }, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated") return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const { id: collectionId } = await params;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = itemSchema.safeParse(body.data);
  if (!parsed.success) return fail("VALIDATION_ERROR", "帖子参数不合法", { status: 400 });
  const removed = await db.bookmarkCollectionItem.deleteMany({ where: { collectionId, postId: parsed.data.postId, collection: { userId: sessionResult.user.id } } });
  if (!removed.count) return fail("NOT_FOUND", "收藏夹条目不存在", { status: 404 });
  return ok({ deleted: true });
}
