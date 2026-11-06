import { fail, ok } from "@/lib/api-response";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { reportSchema } from "@/lib/inspiration-report-schema";
import { readJsonBodySafe } from "@/lib/request-body";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated")
    return fail("UNAUTHORIZED", "请先登录后举报", { status: 401 });
  const rateLimit = await userActionRateLimitResponse(
    sessionResult.user.id,
    "inspiration-report",
    undefined,
    10,
  );
  if (rateLimit) return rateLimit;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = reportSchema.safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "举报信息不合法", { status: 400 });
  const { id: postId } = await params;
  const post = await db.designPost.findFirst({
    where: { id: postId, status: "PUBLISHED", deletedAt: null },
    select: { id: true, authorId: true },
  });
  if (!post) return fail("NOT_FOUND", "帖子不存在", { status: 404 });
  if (parsed.data.commentId) {
    const comment = await db.postComment.findFirst({
      where: { id: parsed.data.commentId, postId, deletedAt: null },
      select: { id: true, authorId: true },
    });
    if (!comment) return fail("NOT_FOUND", "评论不存在", { status: 404 });
    if (comment.authorId === sessionResult.user.id) {
      return fail("INVALID_TARGET", "不能举报自己的评论", { status: 400 });
    }
  } else if (post.authorId === sessionResult.user.id) {
    return fail("INVALID_TARGET", "不能举报自己的帖子", { status: 400 });
  }
  const duplicate = await db.contentReport.findFirst({
    where: {
      reporterId: sessionResult.user.id,
      ...(parsed.data.commentId
        ? { commentId: parsed.data.commentId }
        : { postId }),
      status: { in: ["OPEN", "REVIEWING", "RESOLVED"] },
    },
    select: { id: true, status: true },
  });
  if (duplicate) {
    return fail("CONFLICT", "你已经举报过这条内容，审核结果会在原记录中更新", {
      status: 409,
    });
  }
  const report = await db.contentReport.create({
    data: {
      postId: parsed.data.commentId ? null : postId,
      commentId: parsed.data.commentId || null,
      reporterId: sessionResult.user.id,
      reason: parsed.data.reason,
      note: parsed.data.note || null,
    },
  });
  return ok({ id: report.id, status: report.status }, { status: 201 });
}
