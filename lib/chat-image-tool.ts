import type { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  assertModerationRejectionAllowed,
  recordModerationRejectionAttempt,
} from "@/lib/rate-limit";
import { assertGenerationQueueReady } from "@/lib/queue";
import { assertProviderAvailable } from "@/lib/providers";
import { estimateCost } from "@/lib/credits";
import { db } from "@/lib/db";
import {
  createAndEnqueueGeneration,
  type CreateGenerationResult,
} from "@/lib/generations";
import {
  createPricingSnapshot,
  getModelWithPricing,
} from "@/lib/model-pricing";
import {
  ALL_IMAGE_SIZE_OPTIONS,
  IMAGE_QUALITY_OPTIONS,
} from "@/lib/models/options";
import {
  generationRequestSchema,
  validateAgainstModelDefinition,
  ValidationError,
  UnsupportedParamError,
} from "@/lib/models/validate";
import { isPromptBlocked } from "@/lib/moderation";
import { generationOperation } from "@/lib/generation-operation";
import type { ChatReference } from "@/lib/chat-references-types";
import { resolveChatReferences } from "@/lib/chat-references";
import { normalizeUploadedReferenceKey } from "@/lib/storage";
import {
  ConversationNotFoundError,
  GenerationQueueError,
  InsufficientCreditsError,
} from "@/lib/generations";
export {
  CHAT_IMAGE_TOOL,
  CHAT_IMAGE_RESPONSES_TOOL,
  CHAT_IMAGE_TOOL_NAME,
} from "@/lib/chat-image-tool-definition";

const chatImageToolArgsSchema = z
  .object({
    prompt: z.string().trim().min(1).max(4_000),
    modelId: z.string().trim().min(1).max(128).optional(),
    size: z.enum(ALL_IMAGE_SIZE_OPTIONS).optional(),
    quality: z.enum(IMAGE_QUALITY_OPTIONS).optional(),
    outputFormat: z.enum(["png", "jpeg", "webp", "gif"]).optional(),
    background: z.enum(["auto", "opaque", "transparent"]).optional(),
    n: z.number().int().min(1).max(4).optional(),
  })
  .strict();

export type ChatImageToolArgs = z.infer<typeof chatImageToolArgsSchema>;

export function parseChatImageToolArgs(
  raw: string,
): { ok: true; value: ChatImageToolArgs } | { ok: false; message: string } {
  try {
    const parsed = chatImageToolArgsSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, message: "生图工具参数不完整，请重新描述想生成的画面" };
  } catch {
    return {
      ok: false,
      message: "生图工具参数格式异常，请重新描述想生成的画面",
    };
  }
}

export interface ChatImageToolContext {
  userId: string;
  conversationId: string;
  turnId: string;
  attemptId: string;
  callId: string;
  imageModelId?: string;
  imageSize?: string;
  imageQuality?: string;
  imageOutputFormat?: string;
  imageN?: number;
  referenceImageKeys: string[];
  sourceImageIds: string[];
  references?: ChatReference[];
}

export class ChatImageToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ChatImageToolError";
  }
}

function publicSubmissionError(error: unknown): ChatImageToolError {
  if (error instanceof ChatImageToolError) return error;
  if (error instanceof InsufficientCreditsError)
    return new ChatImageToolError("INSUFFICIENT_CREDITS", "图片生成点数不足");
  if (error instanceof GenerationQueueError)
    return new ChatImageToolError("QUEUE_UNAVAILABLE", "图片生成队列暂不可用");
  if (
    error instanceof ValidationError ||
    error instanceof UnsupportedParamError
  )
    return new ChatImageToolError("UNSUPPORTED_PARAM", error.message);
  if (error instanceof ConversationNotFoundError)
    return new ChatImageToolError("CONVERSATION_NOT_FOUND", "当前对话不存在");
  return new ChatImageToolError(
    "IMAGE_TOOL_UNAVAILABLE",
    "图片生成暂时不可用，请稍后重试",
  );
}

function referenceInputs(context: ChatImageToolContext) {
  const references = context.references?.length
    ? context.references
    : [
        ...context.referenceImageKeys.map((key) => ({
          kind: "upload" as const,
          key,
        })),
        ...context.sourceImageIds.map((id) => ({
          kind: "generated" as const,
          id,
        })),
      ];
  const uploadKeys = references.flatMap((reference) =>
    reference.kind === "upload" ? [reference.key] : [],
  );
  const sourceImageIds = references.flatMap((reference) =>
    reference.kind === "generated" ? [reference.id] : [],
  );
  return { references, uploadKeys, sourceImageIds };
}

async function sourceReferences(userId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.generatedImage.findMany({
    where: {
      id: { in: [...new Set(ids)] },
      generation: { userId, deletedAt: null },
    },
    select: { id: true, storageKey: true, mimeType: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (rows.length !== new Set(ids).size)
    throw new ChatImageToolError(
      "REFERENCE_IMAGE_NOT_FOUND",
      "参考图不存在或不可用",
    );
  return ids.map((id) => byId.get(id)!);
}

function orderedStorageKeys(
  references: ChatReference[],
  sourceById: Map<string, { storageKey: string }>,
) {
  return references.flatMap((reference) => {
    if (reference.kind === "upload") {
      const normalized = normalizeUploadedReferenceKey(reference.key);
      return normalized ? [normalized] : [];
    }
    const key = sourceById.get(reference.id)?.storageKey;
    return key ? [key] : [];
  });
}

export async function enqueueChatImageGeneration(
  args: ChatImageToolArgs,
  context: ChatImageToolContext,
): Promise<CreateGenerationResult> {
  const modelId = args.modelId ?? context.imageModelId ?? "gpt-image-2";
  const model = await getModelWithPricing(modelId);
  if (!model)
    throw new ChatImageToolError("MODEL_NOT_AVAILABLE", "当前图片模型不可用");

  const { references, uploadKeys, sourceImageIds } = referenceInputs(context);
  try {
    await resolveChatReferences(context.userId, references);
  } catch {
    throw new ChatImageToolError(
      "REFERENCE_IMAGE_NOT_FOUND",
      "参考图不存在或不可用",
    );
  }
  const sourceRows = await sourceReferences(context.userId, sourceImageIds);
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
  const input = generationRequestSchema.parse({
    modelId,
    prompt: args.prompt,
    size: args.size ?? context.imageSize,
    quality: args.quality ?? context.imageQuality,
    outputFormat: args.outputFormat ?? context.imageOutputFormat,
    background: args.background,
    n: args.n ?? context.imageN ?? 1,
    referenceImageKeys: uploadKeys,
    sourceImageIds,
  });
  const request = validateAgainstModelDefinition(input, model);
  if (sourceRows.length) {
    if (!model.capabilities.supportsReferenceImage)
      throw new ChatImageToolError(
        "UNSUPPORTED_PARAM",
        "当前图片模型不支持参考图",
      );
    request.referenceImages = [
      ...(request.referenceImages ?? []),
      ...sourceRows.map((row) => ({
        key: row.storageKey,
        mimeType: row.mimeType,
      })),
    ];
  }
  if (
    (request.referenceImages?.length ?? 0) >
    model.capabilities.maxReferenceImages
  )
    throw new ChatImageToolError(
      "UNSUPPORTED_PARAM",
      `参考图最多 ${model.capabilities.maxReferenceImages} 张`,
    );

  await assertProviderAvailable(request.modelId, request.providerChannelId);
  await assertGenerationQueueReady();
  await assertModerationRejectionAllowed(context.userId);
  const combinedPrompt = [request.prompt, request.negativePrompt]
    .filter(Boolean)
    .join("\n");
  if (await isPromptBlocked(combinedPrompt)) {
    await recordModerationRejectionAttempt(context.userId, request.modelId, {
      reason: "blocked_keyword",
    });
    throw new ChatImageToolError(
      "MODERATION_REJECTED",
      "[MODERATION_REJECTED] 提示词或参考图包含不允许的内容，请调整后再试。",
    );
  }

  const estimatedCredits = estimateCost(model, request);
  const pricingSnapshot = createPricingSnapshot(
    model,
    request,
    estimatedCredits,
  );
  const operation = generationOperation(
    `chat:${context.turnId}:${context.callId}`,
    {
      modelId: request.modelId,
      prompt: request.prompt,
      size: request.size,
      quality: request.quality,
      outputFormat: request.outputFormat,
      referenceImageKeys: orderedStorageKeys(references, sourceById),
    },
  );
  return createAndEnqueueGeneration({
    userId: context.userId,
    operation,
    request,
    normalizedRequestParams: {
      ...input,
      size: request.size,
      quality: request.quality,
      responseFormat: request.responseFormat,
      referenceOrder: references.map((reference) =>
        reference.kind === "upload"
          ? `upload:${reference.key}`
          : `source:${reference.id}`,
      ),
      source: "chat_tool",
    } as Prisma.InputJsonObject,
    estimatedCredits,
    pricingSnapshotJson: pricingSnapshot as unknown as Prisma.InputJsonObject,
    referenceImageKeys: orderedStorageKeys(references, sourceById),
  });
}

export async function submitChatImageTool(
  rawArguments: string,
  context: ChatImageToolContext,
) {
  const parsed = parseChatImageToolArgs(rawArguments);
  if (!parsed.ok)
    return {
      ok: false as const,
      code: "INVALID_TOOL_ARGUMENTS",
      message: parsed.message,
    };
  try {
    const result = await enqueueChatImageGeneration(parsed.value, context);
    return {
      ok: true as const,
      generationId: result.generationId,
      status: result.status,
      estimatedCredits: result.estimatedCredits,
      modelId: parsed.value.modelId ?? context.imageModelId ?? "gpt-image-2",
    };
  } catch (error) {
    const publicError = publicSubmissionError(error);
    return {
      ok: false as const,
      code: publicError.code,
      message: publicError.message,
    };
  }
}
