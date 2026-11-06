import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { commentSchema, rankScoreForCounts } from "@/lib/inspiration";
import { isInspirationTextBlocked } from "@/lib/inspiration-moderation";
import { ModerationRejectionLimitError } from "@/lib/rate-limit";
import { readJsonBodySafe } from "@/lib/request-body";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated") return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const { id } = await params;
  const existing = await db.postComment.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return fail("NOT_FOUND", "评论不存在", { status: 404 });
  if (existing.authorId !== sessionResult.user.id) return fail("FORBIDDEN", "你不能修改这条评论", { status: 403 });
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = commentSchema.pick({ content: true }).safeParse(body.data);
  if (!parsed.success) return fail("VALIDATION_ERROR", "评论内容不合法", { status: 400 });
  try {
    if (
      await isInspirationTextBlocked({
        request,
        user: sessionResult.user,
        text: parsed.data.content,
        surface: "COMMENT_EDIT",
      })
    ) {
      return fail("CONTENT_BLOCKED", "评论包含不适合公开的信息", {
        status: 400,
      });
    }
  } catch (error) {
    if (error instanceof ModerationRejectionLimitError) {
      return fail("RATE_LIMITED", error.message, { status: 429 });
    }
    throw error;
  }
  return ok(await db.postComment.update({ where: { id }, data: { content: parsed.data.content } }));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated") return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const { id } = await params;
  const existing = await db.postComment.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return fail("NOT_FOUND", "评论不存在", { status: 404 });
  if (existing.authorId !== sessionResult.user.id) return fail("FORBIDDEN", "你不能删除这条评论", { status: 403 });
  const updated = await db.$transaction(async (tx) => {
    await tx.postComment.update({
      where: { id },
      // Preserve the original body for moderation/audit while serializeComment
      // guarantees that deleted content and identity are never returned publicly.
      data: { deletedAt: new Date() },
    });
    const post = await tx.designPost.update({ where: { id: existing.postId }, data: { commentCount: { decrement: 1 } } });
    return tx.designPost.update({ where: { id: existing.postId }, data: { rankScore: rankScoreForCounts({ likes: post.likeCount, bookmarks: post.bookmarkCount, comments: post.commentCount, derived: post.derivedCount, publishedAt: post.publishedAt }) } });
  });
  return ok({ deleted: true, commentCount: updated.commentCount });
}
