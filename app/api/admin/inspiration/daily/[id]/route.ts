import { Discipline } from "@prisma/client";
import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import {
  canAutomaticallyPublishDailyQuestion,
  dailyQuestionPostStatus,
  normalizeFeaturePostIds,
} from "@/lib/inspiration-admin";
import { readJsonBodySafe } from "@/lib/request-body";
import { sameOriginMutationFailure } from "@/lib/request-origin";

const schema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  prompt: z.string().trim().min(2).max(5_000).optional(),
  discipline: z.nativeEnum(Discipline).optional(),
  keywords: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
  status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional(),
  featurePostIds: z.array(z.string().cuid()).max(12).optional(),
});

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
    return fail("VALIDATION_ERROR", "每日命题修改不合法", { status: 400 });
  const { id } = await params;
  const existing = await db.dailyPrompt.findUnique({
    where: { id },
    include: { questionPost: true },
  });
  if (!existing) return fail("NOT_FOUND", "每日命题不存在", { status: 404 });
  const profile = await db.user.findUnique({
    where: { id: admin.id },
    select: { name: true, email: true },
  });
  const nextStatus = parsed.data.status ?? existing.status;
  const featurePostIds = parsed.data.featurePostIds
    ? normalizeFeaturePostIds(parsed.data.featurePostIds)
    : undefined;
  if (featurePostIds?.length) {
    const featureCount = await db.designPost.count({
      where: {
        id: { in: featurePostIds },
        status: "PUBLISHED",
        deletedAt: null,
        ...(existing.questionPostId
          ? { id: { in: featurePostIds, not: existing.questionPostId } }
          : {}),
      },
    });
    if (featureCount !== featurePostIds.length) {
      return fail(
        "VALIDATION_ERROR",
        "精选内容包含不存在、未发布或官方命题帖子",
        { status: 400 },
      );
    }
  }

  const result = await db.$transaction(async (tx) => {
    let questionPostId = existing.questionPostId;
    if (nextStatus === "PUBLISHED" && !questionPostId) {
      const question = await tx.designPost.create({
        data: {
          authorId: admin.id,
          authorNameSnapshot:
            profile?.name?.trim() ||
            profile?.email?.split("@")[0] ||
            "Chūgǎo 策展",
          shape: "QUESTION",
          discipline: parsed.data.discipline ?? existing.discipline,
          title: parsed.data.title ?? existing.title,
          story: parsed.data.prompt ?? existing.prompt,
          status: "PUBLISHED",
          trustTier: "TRUSTED",
          publishedAt: new Date(),
          rankScore: 24,
        },
      });
      questionPostId = question.id;
    } else if (questionPostId) {
      const questionStatus = canAutomaticallyPublishDailyQuestion(
        existing.questionPost,
      )
        ? dailyQuestionPostStatus(nextStatus)
        : "HIDDEN";
      await tx.designPost.update({
        where: { id: questionPostId },
        data: {
          title: parsed.data.title,
          story: parsed.data.prompt,
          discipline: parsed.data.discipline,
          dailyPromptId: null,
          status: questionStatus,
          publishedAt:
            questionStatus === "PUBLISHED"
              ? (existing.questionPost?.publishedAt ?? new Date())
              : existing.questionPost?.publishedAt,
          hiddenAt:
            questionStatus === "HIDDEN"
              ? (existing.questionPost?.hiddenAt ?? new Date())
              : null,
        },
      });
    }
    const daily = await tx.dailyPrompt.update({
      where: { id },
      data: {
        title: parsed.data.title,
        prompt: parsed.data.prompt,
        discipline: parsed.data.discipline,
        keywords: parsed.data.keywords,
        status: parsed.data.status,
        publishedAt:
          nextStatus === "PUBLISHED"
            ? (existing.publishedAt ?? new Date())
            : existing.publishedAt,
        questionPostId,
      },
    });
    if (featurePostIds) {
      await tx.dailyPromptFeature.deleteMany({ where: { dailyPromptId: id } });
      if (featurePostIds.length)
        await tx.dailyPromptFeature.createMany({
          data: featurePostIds.map((postId, index) => ({
            dailyPromptId: id,
            postId,
            order: index,
          })),
        });
    }
    return daily;
  });
  await audit({
    actorId: admin.id,
    action: "admin.inspiration.daily.update",
    target: id,
    diff: parsed.data,
    request,
  });
  return ok(result);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originFailure = sameOriginMutationFailure(request);
  if (originFailure) return originFailure;
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);
  if (failure) return failure;
  const admin = authenticatedUser(sessionResult);
  const { id } = await params;
  const existing = await db.dailyPrompt.findUnique({ where: { id } });
  if (!existing) return fail("NOT_FOUND", "每日命题不存在", { status: 404 });
  await db.$transaction(async (tx) => {
    await tx.dailyPrompt.update({
      where: { id },
      data: { status: "ARCHIVED" },
    });
    if (existing.questionPostId) {
      await tx.designPost.update({
        where: { id: existing.questionPostId },
        data: { status: "HIDDEN", hiddenAt: new Date(), dailyPromptId: null },
      });
    }
  });
  await audit({
    actorId: admin.id,
    action: "admin.inspiration.daily.archive",
    target: id,
    request,
  });
  return ok({ archived: true });
}
