import { Discipline } from "@prisma/client";
import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import { adminFailureResponse, authenticatedUser, checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  normalizeFeaturePostIds,
  parseDailyPromptDay,
} from "@/lib/inspiration-admin";
import { readJsonBodySafe } from "@/lib/request-body";
import { sameOriginMutationFailure } from "@/lib/request-origin";

const schema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  discipline: z.nativeEnum(Discipline),
  title: z.string().trim().min(2).max(120),
  prompt: z.string().trim().min(2).max(5_000),
  keywords: z.array(z.string().trim().min(1).max(32)).max(12).default([]),
  publish: z.boolean().default(false),
  featurePostIds: z.array(z.string().cuid()).max(12).default([]),
});

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);
  if (failure) return failure;
  const rows = await db.dailyPrompt.findMany({
    include: {
      questionPost: { select: { id: true, title: true, status: true } },
      features: { include: { post: { select: { id: true, title: true } } }, orderBy: { order: "asc" } },
      responses: {
        where: { status: "PUBLISHED", deletedAt: null },
        select: { id: true, title: true, authorNameSnapshot: true },
        orderBy: [{ rankScore: "desc" }, { publishedAt: "desc" }],
        take: 40,
      },
      _count: { select: { responses: true } },
    },
    orderBy: { day: "desc" },
    take: 120,
  });
  return ok({ items: rows });
}

export async function POST(request: Request) {
  const originFailure = sameOriginMutationFailure(request);
  if (originFailure) return originFailure;
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);
  if (failure) return failure;
  const admin = authenticatedUser(sessionResult);
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) return fail("VALIDATION_ERROR", "每日命题内容不完整", { status: 400, details: parsed.error.flatten() });
  const profile = await db.user.findUnique({ where: { id: admin.id }, select: { name: true, email: true } });
  const day = parseDailyPromptDay(parsed.data.day);
  if (!day) return fail("VALIDATION_ERROR", "每日命题日期不合法", { status: 400 });
  const existingForDay = await db.dailyPrompt.findFirst({ where: { day }, select: { id: true } });
  if (existingForDay) return fail("CONFLICT", "这个日期已经有每日命题", { status: 409 });

  const featurePostIds = normalizeFeaturePostIds(parsed.data.featurePostIds);
  if (featurePostIds.length) {
    const featureCount = await db.designPost.count({
      where: { id: { in: featurePostIds }, status: "PUBLISHED", deletedAt: null },
    });
    if (featureCount !== featurePostIds.length) {
      return fail("VALIDATION_ERROR", "精选内容包含不存在或未发布的帖子", { status: 400 });
    }
  }

  const result = await db.$transaction(async (tx) => {
    const daily = await tx.dailyPrompt.create({
      data: {
        day,
        discipline: parsed.data.discipline,
        title: parsed.data.title,
        prompt: parsed.data.prompt,
        keywords: parsed.data.keywords,
        status: parsed.data.publish ? "PUBLISHED" : "DRAFT",
        publishedAt: parsed.data.publish ? new Date() : null,
      },
    });
    let questionPostId: string | null = null;
    if (parsed.data.publish) {
      const question = await tx.designPost.create({
        data: {
          authorId: admin.id,
          authorNameSnapshot: profile?.name?.trim() || profile?.email?.split("@")[0] || "Chūgǎo 策展",
          shape: "QUESTION",
          discipline: parsed.data.discipline,
          title: parsed.data.title,
          story: parsed.data.prompt,
          status: "PUBLISHED",
          trustTier: "TRUSTED",
          publishedAt: new Date(),
          rankScore: 24,
        },
      });
      questionPostId = question.id;
      await tx.dailyPrompt.update({ where: { id: daily.id }, data: { questionPostId } });
    }
    if (featurePostIds.length) {
      await tx.dailyPromptFeature.createMany({ data: featurePostIds.map((postId, index) => ({ dailyPromptId: daily.id, postId, order: index })), skipDuplicates: true });
    }
    return { ...daily, questionPostId };
  });
  await audit({ actorId: admin.id, action: "admin.inspiration.daily.create", target: result.id, diff: { day: parsed.data.day, publish: parsed.data.publish }, request });
  return ok(result, { status: 201 });
}
