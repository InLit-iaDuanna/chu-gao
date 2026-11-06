// PPT 生成 API：创建手动构建的 PPT（不变提示词 + 逐页变的提示词）。
// 创建即快速返回；逐页出图由客户端轮询时调用 /api/ppt/generate-slide 触发，
// 真实出图复用标准生成队列（worker）。

import { z } from "zod";

import { ok, fail } from "@/lib/api-response";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  ConversationNotFoundError,
  GenerationQueueError,
  InsufficientCreditsError,
} from "@/lib/generations";
import { logger } from "@/lib/logger";
import { MAX_PPT_SLIDES } from "@/lib/ppt-generator";
import { encodePptReferenceImageKeys } from "@/lib/ppt-reference";
import { serializePPTGeneration } from "@/lib/ppt-serialize";
import {
  estimatePptSlideCost,
  getModelWithPricing,
  randomSeed,
} from "@/lib/ppt-service";
import { readJsonBodySafe } from "@/lib/request-body";
import {
  normalizeUploadedReferenceKey,
  statPrivateStorageKey,
} from "@/lib/storage";

const SLIDE_INCLUDE = {
  slides: {
    orderBy: { index: "asc" as const },
    include: {
      generation: {
        include: { images: true },
      },
    },
  },
} as const;

const generatePptSchema = z.object({
  modelId: z.string().min(1),
  fixedPrompt: z.string().max(4000).optional().default(""),
  referenceImageKeys: z.array(z.string().min(1)).max(16).optional().default([]),
  title: z.string().trim().max(120).optional(),
  conversationId: z.string().min(1).optional(),
  slides: z
    .array(
      z.object({
        variablePrompt: z.string().trim().min(1).max(4000),
        title: z.string().trim().max(120).optional(),
      }),
    )
    .min(1)
    .max(MAX_PPT_SLIDES),
});

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);

  if (sessionResult.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  if (sessionResult.status === "unauthenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  const rateLimitFailure = await userActionRateLimitResponse(
    sessionResult.user.id,
    "ppt-create",
    process.env.RATE_LIMIT_PPT_PER_MIN,
    10,
  );
  if (rateLimitFailure) return rateLimitFailure;

  const body = await readJsonBodySafe(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = generatePptSchema.safeParse(body.data);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "PPT 参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const session = sessionResult.user;
  const {
    modelId,
    fixedPrompt,
    referenceImageKeys,
    title,
    conversationId,
    slides,
  } = parsed.data;

  try {
    const model = await getModelWithPricing(modelId);
    if (!model) {
      return fail("MODEL_NOT_AVAILABLE", "模型不可用", { status: 400 });
    }

    const normalizedReferenceKeys = [
      ...new Set(
        referenceImageKeys.map((key) => normalizeUploadedReferenceKey(key)),
      ),
    ];
    if (
      normalizedReferenceKeys.some((key) => !key) ||
      normalizedReferenceKeys.some(
        (key) => !key!.startsWith(`uploads/${session.id}/`),
      )
    ) {
      return fail("REFERENCE_IMAGE_NOT_FOUND", "参考图不存在或不可用", {
        status: 404,
      });
    }

    const ownedReferenceKeys = normalizedReferenceKeys as string[];
    if (
      ownedReferenceKeys.length > 0 &&
      (!model.capabilities.supportsReferenceImage ||
        ownedReferenceKeys.length > model.capabilities.maxReferenceImages)
    ) {
      return fail(
        "UNSUPPORTED_PARAM",
        model.capabilities.supportsReferenceImage
          ? `参考图最多 ${model.capabilities.maxReferenceImages} 张`
          : "当前模型不支持参考图",
        { status: 400 },
      );
    }

    try {
      await Promise.all(
        ownedReferenceKeys.map((key) => statPrivateStorageKey(key)),
      );
    } catch {
      return fail("REFERENCE_IMAGE_NOT_FOUND", "参考图不存在或不可用", {
        status: 404,
      });
    }

    const totalCost =
      estimatePptSlideCost(model, ownedReferenceKeys) * slides.length;
    const user = await db.user.findUnique({
      where: { id: session.id },
      select: { credits: true },
    });

    if (!user) {
      return fail("USER_NOT_FOUND", "用户不存在", { status: 404 });
    }

    if (user.credits < totalCost) {
      return fail(
        "INSUFFICIENT_CREDITS",
        `余额不足。需要约 ${totalCost} 点，当前余额 ${user.credits} 点`,
        { status: 402 },
      );
    }

    if (conversationId) {
      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, userId: session.id, archivedAt: null },
        select: { id: true },
      });
      if (!conversation) {
        return fail("CONVERSATION_NOT_FOUND", "对话不存在", { status: 404 });
      }
    }

    const created = await db.pPTGeneration.create({
      data: {
        userId: session.id,
        conversationId: conversationId ?? null,
        title: title ?? null,
        modelId,
        fixedPrompt,
        style: encodePptReferenceImageKeys(ownedReferenceKeys),
        status: "GENERATING",
        progress: 0,
        slides: {
          create: slides.map((slide, index) => ({
            index,
            type: "content",
            title: slide.title ?? null,
            originalContent: slide.variablePrompt,
            enhancedPrompt: "",
            status: "PENDING",
            seed: randomSeed(),
          })),
        },
      },
      include: SLIDE_INCLUDE,
    });

    return ok(serializePPTGeneration(created));
  } catch (error) {
    if (
      error instanceof InsufficientCreditsError ||
      error instanceof ConversationNotFoundError ||
      error instanceof GenerationQueueError
    ) {
      return fail("PPT_CREATE_FAILED", error.message, { status: 400 });
    }

    logger.error({ error }, "PPT generation create failed.");
    return fail("INTERNAL_ERROR", "PPT 创建失败", { status: 500 });
  }
}

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);

  if (sessionResult.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  if (sessionResult.status === "unauthenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  const session = sessionResult.user;
  const { searchParams } = new URL(request.url);
  const pptId = searchParams.get("id");

  try {
    if (!pptId) {
      const records = await db.pPTGeneration.findMany({
        where: { userId: session.id },
        include: SLIDE_INCLUDE,
        orderBy: { createdAt: "desc" },
        take: 20,
      });

      return ok({ items: records.map(serializePPTGeneration) });
    }

    const record = await db.pPTGeneration.findFirst({
      where: { id: pptId, userId: session.id },
      include: SLIDE_INCLUDE,
    });

    if (!record) {
      return fail("NOT_FOUND", "PPT 记录不存在", { status: 404 });
    }

    return ok(serializePPTGeneration(record));
  } catch (error) {
    logger.error({ error }, "PPT generation fetch failed.");
    return fail("INTERNAL_ERROR", "获取 PPT 记录失败", { status: 500 });
  }
}
