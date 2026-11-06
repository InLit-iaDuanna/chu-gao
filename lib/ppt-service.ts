// PPT 生成服务：把「不变 + 该页变的」经 DeepSeek 优化为出图 prompt，
// 并复用标准生成队列（createAndEnqueueGeneration）真正出图。
// 供 /api/ppt/* 路由复用，避免在路由层重复编排，也不再 HTTP 自调用。

import type { Prisma } from "@prisma/client";
import { randomInt } from "node:crypto";

import { getPptSystemPrompt } from "@/lib/ai-config";
import { estimateCost } from "@/lib/credits";
import { db } from "@/lib/db";
import { optimizeImagePrompt } from "@/lib/deepseek";
import { createAndEnqueueGeneration } from "@/lib/generations";
import {
  createPricingSnapshot,
  getModelWithPricing,
} from "@/lib/model-pricing";
import type { InternalRequest } from "@/lib/models/types";
import {
  generationRequestSchema,
  validateAgainstModelDefinition,
} from "@/lib/models/validate";
import { decodePptReferenceImageKeys } from "@/lib/ppt-reference";

const PPT_SIZE = "2048x1152"; // 16:9 横版（2K）

// 用于每页的随机种子（保持各页相关但不同）。服务端专用。
export function randomSeed(): number {
  return randomInt(0, 1_000_000);
}

type ModelWithPricing = NonNullable<
  Awaited<ReturnType<typeof getModelWithPricing>>
>;

interface SlideRequestBundle {
  request: InternalRequest;
  normalizedRequestParams: Prisma.InputJsonValue;
  estimatedCredits: number;
  pricingSnapshotJson: Prisma.InputJsonObject;
}

// 为单页构造出图请求（16:9，单张，模型默认参数）。
function buildSlideRequest(
  model: ModelWithPricing,
  prompt: string,
  seed: number,
  referenceImageKeys: string[],
): SlideRequestBundle {
  const seedParam = model.capabilities.supportsSeed ? seed : undefined;
  const input = generationRequestSchema.parse({
    modelId: model.id,
    prompt,
    size: PPT_SIZE,
    n: 1,
    ...(referenceImageKeys.length ? { referenceImageKeys } : {}),
    ...(seedParam !== undefined ? { seed: seedParam } : {}),
    outputFormat: model.defaults.outputFormat,
    background: model.defaults.background,
    responseFormat: model.defaults.responseFormat,
  });

  const request = validateAgainstModelDefinition(input, model);
  const estimatedCredits = estimateCost(model, request);
  const pricingSnapshot = createPricingSnapshot(
    model,
    request,
    estimatedCredits,
  );

  return {
    request,
    normalizedRequestParams: {
      ...input,
    } as Prisma.InputJsonValue,
    estimatedCredits,
    pricingSnapshotJson: pricingSnapshot as unknown as Prisma.InputJsonObject,
  };
}

// 每页预估点数（用于成本预览）。
export function estimatePptSlideCost(
  model: ModelWithPricing,
  referenceImageKeys: string[] = [],
): number {
  const input = generationRequestSchema.parse({
    modelId: model.id,
    prompt: "placeholder",
    size: PPT_SIZE,
    n: 1,
    ...(referenceImageKeys.length ? { referenceImageKeys } : {}),
    outputFormat: model.defaults.outputFormat,
    background: model.defaults.background,
    responseFormat: model.defaults.responseFormat,
  });
  const request = validateAgainstModelDefinition(input, model);
  return estimateCost(model, request);
}

export { getModelWithPricing };

export class PptSlideGenerationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "PptSlideGenerationError";
  }
}

// 触发单页生成：DeepSeek 优化 → 建 Generation 入队 → 关联 slide。
// 返回新建的 generationId。错误会在 slide 上落 error 字段并抛出。
export async function runSlideGeneration(params: {
  userId: string;
  pptGenerationId: string;
  slideId: string;
}): Promise<{ generationId: string }> {
  const { userId, pptGenerationId, slideId } = params;

  const ppt = await db.pPTGeneration.findFirst({
    where: { id: pptGenerationId, userId },
    include: { slides: { where: { id: slideId } } },
  });

  if (!ppt) {
    throw new PptSlideGenerationError("PPT 不存在", "NOT_FOUND");
  }

  const slide = ppt.slides[0];
  if (!slide) {
    throw new PptSlideGenerationError("幻灯片不存在", "NOT_FOUND");
  }

  const model = await getModelWithPricing(ppt.modelId ?? "");
  if (!model) {
    await db.pPTSlide.update({
      where: { id: slide.id },
      data: { status: "FAILED", error: "模型不可用" },
    });
    throw new PptSlideGenerationError("模型不可用", "MODEL_NOT_AVAILABLE");
  }

  const systemPrompt = await getPptSystemPrompt();
  const finalPrompt = await optimizeImagePrompt({
    contextSystemPrompt: systemPrompt,
    fixedPrompt: ppt.fixedPrompt ?? "",
    variablePrompt: slide.originalContent,
  });

  const seed = slide.seed ?? randomSeed();
  const referenceImageKeys = decodePptReferenceImageKeys(ppt.style);
  const bundle = buildSlideRequest(
    model,
    finalPrompt,
    seed,
    referenceImageKeys,
  );

  try {
    const result = await createAndEnqueueGeneration({
      userId,
      request: bundle.request,
      normalizedRequestParams: bundle.normalizedRequestParams,
      estimatedCredits: bundle.estimatedCredits,
      pricingSnapshotJson: bundle.pricingSnapshotJson,
      referenceImageKeys,
      // 不关联到聊天对话，避免污染 studio 的对话生成列表。
    });

    await db.pPTSlide.update({
      where: { id: slide.id },
      data: {
        enhancedPrompt: finalPrompt,
        generationId: result.generationId,
        seed,
        status: "GENERATING",
        error: null,
      },
    });

    return { generationId: result.generationId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "幻灯片生成失败";
    await db.pPTSlide.update({
      where: { id: slide.id },
      data: { status: "FAILED", error: message },
    });
    throw error;
  }
}
