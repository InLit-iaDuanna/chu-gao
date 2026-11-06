import { fail, ok } from "@/lib/api-response";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getTrustTier, rankScoreForCounts } from "@/lib/inspiration";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated") return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const rateLimit = await userActionRateLimitResponse(sessionResult.user.id, "inspiration-bookmark", undefined, 60);
  if (rateLimit) return rateLimit;
  const { id: postId } = await params;
  const post = await db.designPost.findFirst({ where: { id: postId, status: "PUBLISHED", deletedAt: null } });
  if (!post) return fail("NOT_FOUND", "帖子不存在", { status: 404 });
  const existing = await db.postBookmark.findUnique({ where: { postId_userId: { postId, userId: sessionResult.user.id } } });
  const countsForRank = (await getTrustTier(sessionResult.user.id)) === "TRUSTED";

  const updated = await db.$transaction(async (tx) => {
    if (existing) {
      await tx.postBookmark.delete({ where: { postId_userId: { postId, userId: sessionResult.user.id } } });
      await tx.bookmarkCollectionItem.deleteMany({
        where: { postId, collection: { userId: sessionResult.user.id } },
      });
    } else {
      await tx.postBookmark.create({ data: { postId, userId: sessionResult.user.id, countsForRank } });
    }
    const row = await tx.designPost.update({
      where: { id: postId },
      data: { bookmarkCount: { increment: existing ? -1 : 1 } },
    });
    const [rankLikes, rankBookmarks] = await Promise.all([
      tx.postLike.count({ where: { postId, countsForRank: true } }),
      tx.postBookmark.count({ where: { postId, countsForRank: true } }),
    ]);
    return tx.designPost.update({
      where: { id: postId },
      data: {
        rankScore: rankScoreForCounts({
          likes: rankLikes,
          bookmarks: rankBookmarks,
          comments: row.commentCount,
          derived: row.derivedCount,
          publishedAt: row.publishedAt,
        }),
      },
    });
  });
  return ok({ bookmarked: !existing, count: updated.bookmarkCount });
}
