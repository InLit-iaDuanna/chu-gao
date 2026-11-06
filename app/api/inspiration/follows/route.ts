import { Discipline, FollowTargetType } from "@prisma/client";

import { fail, ok } from "@/lib/api-response";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { followSchema } from "@/lib/inspiration";
import { readJsonBodySafe } from "@/lib/request-body";

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated")
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const items = await db.userFollow.findMany({
    where: { followerId: sessionResult.user.id },
    include: {
      targetUser: { select: { id: true, name: true } },
      tag: { select: { id: true, slug: true, name: true, kind: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return ok({
    items: items.map((item) => ({
      ...item,
      targetUser: item.targetUser
        ? { id: item.targetUser.id, name: item.targetUser.name }
        : null,
    })),
  });
}

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated")
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const rateLimit = await userActionRateLimitResponse(
    sessionResult.user.id,
    "inspiration-follow",
    undefined,
    40,
  );
  if (rateLimit) return rateLimit;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = followSchema.safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "关注对象不合法", { status: 400 });
  const { targetType, targetKey } = parsed.data;

  let targetUserId: string | null = null;
  let discipline: Discipline | null = null;
  let tagId: string | null = null;
  if (targetType === FollowTargetType.USER) {
    if (targetKey === sessionResult.user.id)
      return fail("VALIDATION_ERROR", "不能关注自己", { status: 400 });
    const user = await db.user.findUnique({
      where: { id: targetKey },
      select: { id: true },
    });
    if (!user) return fail("NOT_FOUND", "设计师不存在", { status: 404 });
    targetUserId = user.id;
  } else if (targetType === FollowTargetType.DISCIPLINE) {
    if (!Object.values(Discipline).includes(targetKey as Discipline))
      return fail("VALIDATION_ERROR", "学科不存在", { status: 400 });
    discipline = targetKey as Discipline;
  } else {
    const tag = await db.designTag.findUnique({
      where: { id: targetKey },
      select: { id: true },
    });
    if (!tag) return fail("NOT_FOUND", "标签不存在", { status: 404 });
    tagId = tag.id;
  }

  const key = {
    followerId_targetType_targetKey: {
      followerId: sessionResult.user.id,
      targetType,
      targetKey,
    },
  };
  const existing = await db.userFollow.findUnique({ where: key });
  const shouldFollow = parsed.data.following ?? !existing;
  if (shouldFollow && !existing) {
    await db.userFollow.create({
      data: {
        followerId: sessionResult.user.id,
        targetType,
        targetKey,
        targetUserId,
        discipline,
        tagId,
      },
    });
  } else if (!shouldFollow && existing) {
    await db.userFollow.delete({ where: key });
  }
  return ok({ following: shouldFollow, targetType, targetKey });
}
