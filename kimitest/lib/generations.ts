import type { Prisma } from "@prisma/client";

import { publicChannelAlias } from "@/lib/channel-alias";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { InternalRequest } from "@/lib/models/types";
import {
  displayNameForProviderChannelWithMap,
  getImage2ProviderChannelName,
  resolveImage2ProviderChannelId,
  type Image2ChannelDisplayNameMap,
} from "@/lib/provider-channels";
import { serializeProviderError } from "@/lib/providers/diagnostics";
import { enqueueGeneration } from "@/lib/queue";
import { assertGenerationAllowedForClient } from "@/lib/rate-limit";
import { privateImageThumbnailUrl, privateImageUrl } from "@/lib/storage";

export const GENERATION_STATUSES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
] as const;

export type GenerationStatusFilter = (typeof GENERATION_STATUSES)[number];

export type GenerationWithRelations = Prisma.GenerationGetPayload<{
  include: {
    images: true;
    provider: {
      select: {
        id: true;
        name: true;
      };
    };
    providerAccount: {
      select: {
        id: true;
        name: true;
        baseUrl: true;
      };
    };
  };
}>;

export function isGenerationStatus(
  value: string | null,
): value is GenerationStatusFilter {
  return Boolean(
    value && GENERATION_STATUSES.includes(value as GenerationStatusFilter),
  );
}

export function serializeGeneration(
  row: GenerationWithRelations,
  options: { displayNameMap?: Image2ChannelDisplayNameMap } = {},
) {
  const images = [...row.images]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((image) => ({
      id: image.id,
      url: privateImageUrl(row.id, image.id),
      src: privateImageUrl(row.id, image.id),
      downloadUrl: privateImageUrl(row.id, image.id),
      thumbnailUrl: image.thumbnailKey
        ? privateImageThumbnailUrl(row.id, image.id)
        : privateImageUrl(row.id, image.id),
      width: image.width,
      height: image.height,
      mimeType: image.mimeType,
      createdAt: image.createdAt,
    }));

  const providerChannelId = resolveImage2ProviderChannelId(
    row.modelId,
    row.paramsRaw,
    row.providerAccount?.baseUrl,
  );
  const paramsRaw =
    row.paramsRaw && typeof row.paramsRaw === "object"
      ? (row.paramsRaw as Record<string, unknown>)
      : null;
  const paramsProviderChannelBaseUrl =
    typeof paramsRaw?.providerChannelBaseUrl === "string"
      ? paramsRaw.providerChannelBaseUrl
      : null;
  const paramsProviderChannelName =
    typeof paramsRaw?.providerChannelName === "string"
      ? paramsRaw.providerChannelName
      : null;

  return {
    id: row.id,
    conversationId: row.conversationId,
    modelId: row.modelId,
    prompt: row.prompt,
    negativePrompt: row.negativePrompt,
    aspectRatio: row.aspectRatio,
    resolution: row.resolution,
    n: row.n,
    outputFormat: row.outputFormat,
    referenceImageKeys: row.referenceImageKeys,
    status: row.status,
    provider: row.provider?.name ?? null,
    providerChannelId,
    providerChannelName:
      paramsProviderChannelName ??
      displayNameForProviderChannelWithMap(
        row.providerAccount?.baseUrl ?? paramsProviderChannelBaseUrl,
        row.provider?.name,
        options.displayNameMap,
      ) ??
      getImage2ProviderChannelName(providerChannelId),
    providerAccountName: publicChannelAlias(
      row.providerAccount?.name,
      row.provider?.name,
      row.providerAccount?.baseUrl,
    ),
    progress: row.progress,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    credits: row.costCredits,
    costCredits: row.costCredits,
    attempts: row.attempts,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
    images,
  };
}

export function serializeAdminGeneration(
  row: GenerationWithRelations,
  options: { displayNameMap?: Image2ChannelDisplayNameMap } = {},
) {
  const generation = serializeGeneration(row, options);
  const sortedImages = [...row.images].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  return {
    ...generation,
    providerId: row.providerId,
    jobId: row.jobId,
    images: generation.images.map((image, index) => ({
      ...image,
      storageKey: sortedImages[index]?.storageKey,
    })),
  };
}

// 以下错误类供 /api/generations 与 PPT 等调用方共享，便于映射成对应 HTTP 状态。
export class InsufficientCreditsError extends Error {
  constructor() {
    super("点数不足");
    this.name = "InsufficientCreditsError";
  }
}

export class ConversationNotFoundError extends Error {
  constructor() {
    super("对话不存在");
    this.name = "ConversationNotFoundError";
  }
}

export class GenerationQueueError extends Error {
  constructor(message = "任务入队失败，已退还点数") {
    super(message);
    this.name = "GenerationQueueError";
  }
}

export interface CreateGenerationInput {
  userId: string;
  // 已通过 validateAgainstModelDefinition 处理、且 referenceImages 已就绪的内部请求。
  request: InternalRequest;
  // 落库 paramsRaw 的归一化参数（含 providerChannel 信息等）。
  normalizedRequestParams: Prisma.InputJsonValue;
  estimatedCredits: number;
  pricingSnapshotJson: Prisma.InputJsonObject;
  conversationId?: string;
  // 最终参考图 storageKey 列表（含来源图）。
  referenceImageKeys?: string[];
  // 可选：写入对话的用户/助手消息。
  userMessage?: string;
  assistantMessage?: string;
}

export interface CreateGenerationResult {
  generationId: string;
  status: string;
  jobId: string | null;
}

// 共享的「建 Generation + 扣点 + 入队」逻辑。
// 抽取自 /api/generations POST，供普通生图与 PPT 逐页生成复用（避免 HTTP 自调用）。
// 入队失败时回滚状态、退还点数，并抛出 GenerationQueueError。
export async function createAndEnqueueGeneration(
  input: CreateGenerationInput,
): Promise<CreateGenerationResult> {
  const {
    userId,
    request,
    normalizedRequestParams,
    estimatedCredits,
    pricingSnapshotJson,
    conversationId,
    referenceImageKeys = [],
    userMessage,
    assistantMessage,
  } = input;

  const generation = await db.$transaction(async (tx) => {
    // Serialize per-user task creation so limit checks and inserts stay aligned.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId})::bigint)`;
    await assertGenerationAllowedForClient(tx, userId);

    if (conversationId) {
      const conversation = await tx.conversation.findFirst({
        where: {
          id: conversationId,
          userId,
          archivedAt: null,
        },
        select: { id: true },
      });

      if (!conversation) {
        throw new ConversationNotFoundError();
      }
    }

    const created = await tx.generation.create({
      data: {
        userId,
        conversationId,
        modelId: request.modelId,
        prompt: request.prompt,
        negativePrompt: request.negativePrompt,
        aspectRatio: request.aspectRatio,
        resolution: request.resolution,
        n: request.n,
        seed: request.seed === undefined ? undefined : BigInt(request.seed),
        outputFormat: request.outputFormat,
        paramsRaw: normalizedRequestParams,
        referenceImageKeys,
        status: "PENDING",
        progress: 0,
        costCredits: estimatedCredits,
        pricingSnapshot: pricingSnapshotJson,
      },
    });

    if (conversationId) {
      if (userMessage?.trim()) {
        await tx.conversationMessage.create({
          data: {
            conversationId,
            role: "USER",
            content: userMessage.trim(),
          },
        });
      }

      if (assistantMessage?.trim()) {
        await tx.conversationMessage.create({
          data: {
            conversationId,
            role: "ASSISTANT",
            content: assistantMessage.trim(),
            generationId: created.id,
          },
        });
      }

      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      });
    }

    const debited = await tx.user.updateMany({
      where: {
        id: userId,
        credits: { gte: estimatedCredits },
      },
      data: {
        credits: { decrement: estimatedCredits },
      },
    });

    if (debited.count === 0) {
      throw new InsufficientCreditsError();
    }

    await tx.usageLog.create({
      data: {
        userId,
        generationId: created.id,
        modelId: request.modelId,
        action: "generate",
        creditsDelta: -estimatedCredits,
        metadata: {
          estimatedCredits,
          pricingSnapshot: pricingSnapshotJson,
        },
      },
    });

    return created;
  });

  let jobId: string | null = null;

  try {
    jobId = await enqueueGeneration({
      generationId: generation.id,
      userId,
      request,
      estimatedCredits,
    });

    await db.generation.update({
      where: { id: generation.id },
      data: { jobId },
    });
  } catch (error) {
    await db.$transaction([
      db.generation.update({
        where: { id: generation.id },
        data: {
          status: "FAILED",
          errorCode: "QUEUE_ERROR",
          errorMessage: "任务队列暂不可用，请稍后重试。",
        },
      }),
      db.user.update({
        where: { id: userId },
        data: { credits: { increment: estimatedCredits } },
      }),
      db.usageLog.create({
        data: {
          userId,
          generationId: generation.id,
          modelId: request.modelId,
          action: "refund",
          creditsDelta: estimatedCredits,
          metadata: { reason: "queue_failed" },
        },
      }),
    ]);

    logger.error(
      { generationId: generation.id, error: serializeProviderError(error) },
      "Generation enqueue failed.",
    );

    throw new GenerationQueueError();
  }

  return {
    generationId: generation.id,
    status: generation.status,
    jobId,
  };
}
