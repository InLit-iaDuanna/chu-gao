// 单页生成 / 重新生成：DeepSeek 优化提示词 → 入队 → 关联 slide。
// 状态由关联 Generation 推导（见 lib/ppt-serialize），不再服务端轮询。

import { z } from "zod";

import { ok, fail } from "@/lib/api-response";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  GenerationQueueError,
  InsufficientCreditsError,
} from "@/lib/generations";
import { logger } from "@/lib/logger";
import { PptSlideGenerationError, runSlideGeneration } from "@/lib/ppt-service";
import { readJsonBodySafe } from "@/lib/request-body";

const generateSlideSchema = z.object({
  pptId: z.string().min(1),
  slideId: z.string().min(1),
  // 可选：重新生成前更新该页「变的提示词」。
  variablePrompt: z.string().trim().min(1).max(4000).optional(),
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
    "ppt-slide-generate",
    process.env.RATE_LIMIT_PPT_PER_MIN,
    10,
  );
  if (rateLimitFailure) return rateLimitFailure;

  const body = await readJsonBodySafe(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = generateSlideSchema.safeParse(body.data);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const session = sessionResult.user;
  const { pptId, slideId, variablePrompt } = parsed.data;

  try {
    // 校验归属并可选更新该页提示词。
    const slide = await db.pPTSlide.findFirst({
      where: { id: slideId, pptGeneration: { id: pptId, userId: session.id } },
      select: { id: true },
    });

    if (!slide) {
      return fail("NOT_FOUND", "幻灯片不存在", { status: 404 });
    }

    if (variablePrompt !== undefined) {
      await db.pPTSlide.update({
        where: { id: slideId },
        data: { originalContent: variablePrompt },
      });
    }

    const result = await runSlideGeneration({
      userId: session.id,
      pptGenerationId: pptId,
      slideId,
    });

    return ok({ slideId, generationId: result.generationId });
  } catch (error) {
    if (error instanceof PptSlideGenerationError) {
      return fail(error.code, error.message, {
        status: error.code === "NOT_FOUND" ? 404 : 400,
      });
    }

    if (error instanceof InsufficientCreditsError) {
      return fail("INSUFFICIENT_CREDITS", "点数不足", { status: 402 });
    }

    if (error instanceof GenerationQueueError) {
      return fail("QUEUE_UNAVAILABLE", error.message, { status: 503 });
    }

    logger.error({ error }, "PPT slide generation failed.");
    return fail("INTERNAL_ERROR", "幻灯片生成失败", { status: 500 });
  }
}
