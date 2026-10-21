import type { Prisma } from "@prisma/client";

import { publicChannelAlias } from "@/lib/channel-alias";
import { db } from "@/lib/db";
import {
  findGenerationOperation,
  type GenerationOperation,
} from "@/lib/generation-operation";
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
import { assertChatConversationIdle } from "@/lib/chat-turns";
import { assertAgentSubmission } from "@/lib/agent-auth";

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
  options: {
    displayNameMap?: Image2ChannelDisplayNameMap;
    exposeProviderDetails?: boolean;
  } = {},
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
  const exposeProviderDetails = options.exposeProviderDetails === true;

  return {
    id: row.id,
    source: row.agentAuthorizationId ? "agent" : "web",
    conversationId: row.conversationId,
    modelId: row.modelId,
    prompt: row.prompt,
    negativePrompt: row.negativePrompt,
    aspectRatio: row.aspectRatio,
    resolution: row.resolution,
    size: typeof paramsRaw?.size === "string" ? paramsRaw.size : null,
    seed: row.seed === null ? null : Number(row.seed),
    n: row.n,
    outputFormat: row.outputFormat,
    referenceImageKeys: row.referenceImageKeys,
    status: row.status,
    provider: exposeProviderDetails ? (row.provider?.name ?? null) : null,
    providerChannelId: exposeProviderDetails ? providerChannelId : null,
    providerChannelName: exposeProviderDetails
      ? (paramsProviderChannelName ??
        displayNameForProviderChannelWithMap(
          row.providerAccount?.baseUrl ?? paramsProviderChannelBaseUrl,
          row.provider?.name,
          options.displayNameMap,
        ) ??
        getImage2ProviderChannelName(providerChannelId))
      : null,
    providerAccountName: exposeProviderDetails
      ? publicChannelAlias(
          row.providerAccount?.name,
          row.provider?.name,
          row.providerAccount?.baseUrl,
        )
      : null,
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
  const generation = serializeGeneration(row, {
    ...options,
    exposeProviderDetails: true,
  });
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
  agentAuthorizationId?: string;
  apiKeyId?: string;
  operation?: GenerationOperation;
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
  estimatedCredits: number;
}

// 共享的「建 Generation + 扣点 + 入队」逻辑。
// 抽取自 /api/generations POST，供普通生图与 PPT 逐页生成复用（避免 HTTP 自调用）。
// 入队失败时，仅终止并退款仍未开始执行的本次提交。
export async function createAndEnqueueGeneration(
  input: CreateGenerationInput,
): Promise<CreateGenerationResult> {
  const {
    userId,
    agentAuthorizationId,
    apiKeyId,
    operation,
    request,
    normalizedRequestParams,
    estimatedCredits,
    pricingSnapshotJson,
    conversationId,
    referenceImageKeys = [],
    userMessage,
    assistantMessage,
  } = input;

  const createdResult = await db.$transaction(async (tx) => {
    // Serialize per-user task creation so limit checks and inserts stay aligned.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId})::bigint)`;
    if (operation) {
      const replay = await findGenerationOperation(userId, operation, tx);
      if (agentAuthorizationId) {
        const grant = await assertAgentSubmission(tx, agentAuthorizationId, userId, replay?.generationId);
        if (replay && grant.mode === "single" && !grant.boundGenerationId)
          await tx.agentAuthorization.update({where: {id: grant.id}, data: {boundGenerationId: replay.generationId}});
      }
      if (replay) return { kind: "replay" as const, replay };
    } else if (agentAuthorizationId) {
      await assertAgentSubmission(tx, agentAuthorizationId, userId);
    }
    await assertGenerationAllowedForClient(tx, userId);

    if (conversationId) {
      await assertChatConversationIdle(tx, conversationId, userId);
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
        agentAuthorizationId,
        apiKeyId,
        conversationId,
        modelId: request.modelId,
        prompt: request.prompt,
        negativePrompt: request.negativePrompt,
        aspectRatio: request.aspectRatio,
        resolution: request.resolution,
        n: request.n,
        seed: request.seed === undefined ? undefined : BigInt(request.seed),
        outputFormat: request.outputFormat,
        paramsRaw: operation
          ? {
              ...(normalizedRequestParams as Prisma.InputJsonObject),
              _submission: { ...operation },
            }
          : normalizedRequestParams,
        referenceImageKeys,
        status: "PENDING",
        progress: 0,
        costCredits: estimatedCredits,
        pricingSnapshot: pricingSnapshotJson,
      },
    });

    if (agentAuthorizationId) {
      await tx.agentAuthorization.updateMany({where: {id: agentAuthorizationId, mode: "single", boundGenerationId: null}, data: {boundGenerationId: created.id}});
    }

    // Persist the deterministic queue ID before dispatch. A failed database
    // write after queue.add must never turn an accepted job into a refund.
    await tx.generation.update({
      where: { id: created.id },
      data: { jobId: created.id },
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
        data: { lastMessageAt: new Date(), contextRevision: { increment: 1 } },
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
          ...(agentAuthorizationId ? {source: "agent", agentAuthorizationId} : {}),
          pricingSnapshot: pricingSnapshotJson,
        },
      },
    });

    return { kind: "created" as const, generation: created };
  });

  if (createdResult.kind === "replay") return createdResult.replay;
  const generation = createdResult.generation;

  const jobId = generation.id;

  try {
    await enqueueGeneration(
      {
        generationId: generation.id,
        userId,
        request,
        estimatedCredits,
      },
      { jobId },
    );
  } catch (error) {
    const failed = await db.$transaction(async (tx) => {
      // A lost queue acknowledgement can race with execution or cancellation.
      // Claim the untouched submission before reading its ledger or refunding.
      const claimed = await tx.generation.updateMany({
        where: {
          id: generation.id,
          userId,
          status: "PENDING",
          executionToken: null,
          attempts: 0,
          heartbeatAt: null,
          jobId,
        },
        data: {
          status: "FAILED",
          errorCode: "QUEUE_ERROR",
          errorMessage: "任务队列暂不可用，请稍后重试。",
          finishedAt: new Date(),
        },
      });

      if (claimed.count === 0) {
        return false;
      }

      const charged = await tx.usageLog.aggregate({
        where: { generationId: generation.id, action: "generate" },
        _sum: { creditsDelta: true },
      });
      const refunded = await tx.usageLog.aggregate({
        where: { generationId: generation.id, action: "refund" },
        _sum: { creditsDelta: true },
      });
      const refundableCredits = Math.max(
        0,
        Math.max(0, -(charged._sum.creditsDelta ?? 0)) -
          Math.max(0, refunded._sum.creditsDelta ?? 0),
      );

      if (refundableCredits > 0) {
        await tx.user.update({
          where: { id: userId },
          data: { credits: { increment: refundableCredits } },
        });
        await tx.usageLog.create({
          data: {
            userId,
            generationId: generation.id,
            modelId: request.modelId,
            action: "refund",
            creditsDelta: refundableCredits,
            metadata: { reason: "queue_failed" },
          },
        });
      }

      return true;
    });

    logger.error(
      {
        generationId: generation.id,
        failedBeforeExecution: failed,
        error: serializeProviderError(error),
      },
      "Generation enqueue acknowledgement failed.",
    );

    if (failed) {
      throw new GenerationQueueError();
    }

    const current = await db.generation.findUniqueOrThrow({
      where: { id: generation.id },
      select: { status: true, jobId: true },
    });
    return {
      generationId: generation.id,
      status: current.status,
      jobId: current.jobId,
      estimatedCredits,
    };
  }

  return {
    generationId: generation.id,
    status: generation.status,
    jobId,
    estimatedCredits,
  };
}
