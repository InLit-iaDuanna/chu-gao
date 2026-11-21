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
    source_images: z.array(z.string()).optional(),
  })
  .strict();

export type ChatImageToolArgs = z.infer<typeof chatImageToolArgsSchema>;

/** At most this many earlier images can be referenced by one call. */
export const CHAT_SOURCE_IMAGES_LIMIT = 4;
const SOURCE_SELECTOR_PATTERN = /^(?:latest(?::([1-9]))?|[A-Za-z0-9_-]{1,128})$/;

/**
 * Cleans source_images: trims, drops anything that is neither an image id nor
 * "latest" / "latest:N", removes duplicates. Returns null when the value is
 * not usable at all (so it can be reported in `ignored`).
 */
function parseSourceImages(value: unknown): string[] | null {
  const items =
    typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
  if (!items) return null;
  const selectors: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    let selector = item.trim();
    if (/^latest/i.test(selector)) selector = selector.toLowerCase();
    if (!SOURCE_SELECTOR_PATTERN.test(selector)) continue;
    if (selector === "latest:1") selector = "latest";
    if (!selectors.includes(selector)) selectors.push(selector);
  }
  return selectors.length ? selectors : null;
}

const OPTIONAL_TOOL_ARGS = [
  "modelId",
  "size",
  "quality",
  "outputFormat",
  "background",
  "n",
] as const;

/**
 * Parses the model's tool arguments.
 *
 * Only `prompt` can fail the call. The tool runs once per turn, so a bad
 * optional value must not cost the user the whole image: models routinely
 * send `null` for parameters they do not want to set, numbers as strings,
 * or a size outside the enum. Those are dropped and reported in `ignored`;
 * the user's current image settings apply instead. Failure messages name
 * the cause so it is visible in the stored tool result.
 */
export function parseChatImageToolArgs(
  raw: string,
):
  | { ok: true; value: ChatImageToolArgs; ignored: string[] }
  | { ok: false; message: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      message: "生图工具参数格式异常，请重新描述想生成的画面",
    };
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    return {
      ok: false,
      message: "生图工具参数格式异常，请重新描述想生成的画面",
    };
  const record = data as Record<string, unknown>;
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  if (!prompt)
    return {
      ok: false,
      message: "生图工具缺少画面描述，请重新描述想生成的画面",
    };
  if (prompt.length > 4_000)
    return {
      ok: false,
      message: "画面描述超过 4000 字，请精简后重试",
    };

  const value: Record<string, unknown> = { prompt };
  const ignored: string[] = [];
  if (
    record.source_images !== undefined &&
    record.source_images !== null &&
    record.source_images !== "" &&
    !(Array.isArray(record.source_images) && !record.source_images.length)
  ) {
    const sourceImages = parseSourceImages(record.source_images);
    if (sourceImages) value.source_images = sourceImages;
    else ignored.push("source_images");
  }
  for (const key of OPTIONAL_TOOL_ARGS) {
    let candidate = record[key];
    if (candidate === undefined || candidate === null || candidate === "")
      continue;
    if (key === "n" && typeof candidate === "string" && /^\d+$/.test(candidate))
      candidate = Number(candidate);
    const field = chatImageToolArgsSchema.shape[key].safeParse(candidate);
    if (field.success && field.data !== undefined) value[key] = field.data;
    else ignored.push(key);
  }
  for (const key of Object.keys(record))
    if (
      key !== "prompt" &&
      key !== "source_images" &&
      !(OPTIONAL_TOOL_ARGS as readonly string[]).includes(key)
    )
      ignored.push(key);
  return { ok: true, value: value as ChatImageToolArgs, ignored };
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

function turnReferences(context: ChatImageToolContext): ChatReference[] {
  return context.references?.length
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
}

function referenceInputs(references: ChatReference[]) {
  const uploadKeys = references.flatMap((reference) =>
    reference.kind === "upload" ? [reference.key] : [],
  );
  const sourceImageIds = references.flatMap((reference) =>
    reference.kind === "generated" ? [reference.id] : [],
  );
  return { references, uploadKeys, sourceImageIds };
}

/**
 * Resolves source_images selectors to image ids of this conversation.
 *
 * An image qualifies only when its generation belongs to the user, is not
 * deleted, succeeded, and is linked to the current conversation (chat-tool
 * generations are linked through their assistant message). "latest" is the
 * first image of the most recent such generation, "latest:N" its N-th image.
 */
export async function resolveConversationSourceImages(
  userId: string,
  conversationId: string,
  selectors: string[],
): Promise<string[]> {
  if (selectors.length > CHAT_SOURCE_IMAGES_LIMIT)
    throw new ChatImageToolError(
      "TOO_MANY_SOURCE_IMAGES",
      `source_images 最多引用 ${CHAT_SOURCE_IMAGES_LIMIT} 张图片`,
    );
  const generationScope = {
    userId,
    deletedAt: null,
    status: "SUCCEEDED" as const,
    OR: [{ conversationId }, { messages: { some: { conversationId } } }],
  };
  let latest: string[] | null = null;
  if (selectors.some((selector) => selector.startsWith("latest"))) {
    const generation = await db.generation.findFirst({
      where: { ...generationScope, images: { some: {} } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        images: {
          select: { id: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    });
    latest = generation?.images.map((image) => image.id) ?? [];
  }
  const explicit = selectors.filter((selector) => !selector.startsWith("latest"));
  const owned = explicit.length
    ? new Set(
        (
          await db.generatedImage.findMany({
            where: { id: { in: explicit }, generation: generationScope },
            select: { id: true },
          })
        ).map((row) => row.id),
      )
    : new Set<string>();
  const missing = explicit.filter((id) => !owned.has(id));
  if (missing.length)
    throw new ChatImageToolError(
      "SOURCE_IMAGE_NOT_FOUND",
      `这些图片不属于本对话、已删除或没有生成成功：${missing
        .slice(0, 4)
        .join(", ")}`,
    );
  const ids: string[] = [];
  for (const selector of selectors) {
    let id = selector;
    if (selector.startsWith("latest")) {
      const index = Number(selector.split(":")[1] ?? 1);
      if (!latest?.length)
        throw new ChatImageToolError(
          "SOURCE_IMAGE_NOT_FOUND",
          "本对话还没有生成成功的图片，无法引用 latest",
        );
      if (index > latest.length)
        throw new ChatImageToolError(
          "SOURCE_IMAGE_NOT_FOUND",
          `本对话最近一次只生成了 ${latest.length} 张图片，没有第 ${index} 张`,
        );
      id = latest[index - 1];
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** This turn's references first, then the referenced earlier images. */
export function mergeSourceImages(
  references: ChatReference[],
  sourceImageIds: string[],
): ChatReference[] {
  const merged = [...references];
  for (const id of sourceImageIds)
    if (
      !merged.some(
        (reference) => reference.kind === "generated" && reference.id === id,
      )
    )
      merged.push({ kind: "generated", id });
  return merged;
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

  const current = turnReferences(context);
  const selected = args.source_images?.length
    ? await resolveConversationSourceImages(
        context.userId,
        context.conversationId,
        args.source_images,
      )
    : [];
  const { references, uploadKeys, sourceImageIds } = referenceInputs(
    mergeSourceImages(current, selected),
  );
  if (selected.length && !model.capabilities.supportsReferenceImage)
    throw new ChatImageToolError(
      "UNSUPPORTED_PARAM",
      "当前图片模型不支持参考图",
    );
  if (
    selected.length &&
    (references.length > model.capabilities.maxReferenceImages ||
      sourceImageIds.length > CHAT_SOURCE_IMAGES_LIMIT)
  )
    throw new ChatImageToolError(
      "TOO_MANY_REFERENCE_IMAGES",
      `参考图超过上限：本轮附带 ${current.length} 张，source_images 又引用了 ${references.length - current.length} 张；当前图片模型最多 ${model.capabilities.maxReferenceImages} 张，其中历史生成图最多 ${CHAT_SOURCE_IMAGES_LIMIT} 张`,
    );
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
  // Optional parameters the assistant picked on its own (e.g. background
  // "opaque" for "白色背景") must not sink the whole submission when the model
  // cannot honour them; fall back to the user's settings instead.
  const capabilities = model.capabilities as {
    backgrounds?: readonly string[];
    outputFormats?: readonly string[];
  };
  const background =
    args.background && capabilities.backgrounds?.includes(args.background)
      ? args.background
      : undefined;
  const outputFormat =
    args.outputFormat && capabilities.outputFormats?.includes(args.outputFormat)
      ? args.outputFormat
      : context.imageOutputFormat;
  const input = generationRequestSchema.parse({
    modelId,
    prompt: args.prompt,
    size: args.size ?? context.imageSize,
    quality: args.quality ?? context.imageQuality,
    outputFormat,
    background,
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
      ...(parsed.ignored.length ? { ignored: parsed.ignored } : {}),
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
