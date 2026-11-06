import { fail, ok } from "@/lib/api-response";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  commentSchema,
  rankScoreForCounts,
  serializeComment,
  type CommentTreeRow,
} from "@/lib/inspiration";
import { isInspirationTextBlocked } from "@/lib/inspiration-moderation";
import { ModerationRejectionLimitError } from "@/lib/rate-limit";
import { readJsonBodySafe } from "@/lib/request-body";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: postId } = await params;
  const post = await db.designPost.findFirst({ where: { id: postId, status: "PUBLISHED", deletedAt: null }, select: { id: true } });
  if (!post) return fail("NOT_FOUND", "帖子不存在", { status: 404 });
  const rows = await db.postComment.findMany({
    where: { postId },
    include: {
      author: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 300,
  });
  const children = new Map<string | null, typeof rows>();
  for (const row of rows) {
    const list = children.get(row.parentId) ?? [];
    list.push(row);
    children.set(row.parentId, list);
  }
  const build = (parentId: string | null): CommentTreeRow[] =>
    (children.get(parentId) ?? []).map((row) => ({
      ...row,
      replies: build(row.id),
    }));
  return ok({ items: build(null).map(serializeComment) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated") return fail("UNAUTHORIZED", "请先登录后参与讨论", { status: 401 });
  const rateLimit = await userActionRateLimitResponse(sessionResult.user.id, "inspiration-comment", process.env.RATE_LIMIT_INSPIRATION_COMMENT_PER_MIN, 20);
  if (rateLimit) return rateLimit;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = commentSchema.safeParse(body.data);
  if (!parsed.success) return fail("VALIDATION_ERROR", "评论内容不合法", { status: 400 });
  try {
    if (
      await isInspirationTextBlocked({
        request,
        user: sessionResult.user,
        text: parsed.data.content,
        surface: "COMMENT_CREATE",
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
  const { id: postId } = await params;
  const post = await db.designPost.findFirst({ where: { id: postId, status: "PUBLISHED", deletedAt: null } });
  if (!post) return fail("NOT_FOUND", "帖子不存在", { status: 404 });
  if (parsed.data.parentId) {
    const parent = await db.postComment.findFirst({ where: { id: parsed.data.parentId, postId, deletedAt: null } });
    if (!parent) return fail("VALIDATION_ERROR", "回复的评论不存在", { status: 400 });
  }
  const profile = await db.user.findUnique({ where: { id: sessionResult.user.id }, select: { name: true, email: true } });
  const row = await db.$transaction(async (tx) => {
    const comment = await tx.postComment.create({
      data: {
        postId,
        parentId: parsed.data.parentId || null,
        authorId: sessionResult.user.id,
        authorNameSnapshot: profile?.name?.trim() || profile?.email?.split("@")[0] || "设计师",
        content: parsed.data.content,
      },
      include: {
        author: { select: { id: true, name: true, email: true } },
        replies: true,
      },
    });
    const updated = await tx.designPost.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } });
    await tx.designPost.update({
      where: { id: postId },
      data: { rankScore: rankScoreForCounts({ likes: updated.likeCount, bookmarks: updated.bookmarkCount, comments: updated.commentCount, derived: updated.derivedCount, publishedAt: updated.publishedAt }) },
    });
    return comment;
  });
  return ok(serializeComment(row), { status: 201 });
}
