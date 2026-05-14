import type { Prisma } from "@prisma/client";

import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { estimateCost } from "@/lib/credits";
import { db } from "@/lib/db";
import { isGenerationStatus, serializeGeneration } from "@/lib/generations";
import { logger } from "@/lib/logger";
import { getProviderChannelDisplayNameMap } from "@/lib/provider-channel-config";
import { isPromptBlocked } from "@/lib/moderation";
import {
  createPricingSnapshot,
  getModelWithPricing,
} from "@/lib/model-pricing";
import {
  ValidationError,
  UnsupportedParamError,
  generationRequestSchema,
  validateAgainstModelDefinition,
} from "@/lib/models/validate";
import {
  ModelNotAvailableError,
  ProviderUnavailableError,
  assertProviderAvailable,
  providerChannelMatchesBaseUrl,
  supportedModelIds,
} from "@/lib/providers";
import {
  displayNameForProviderChannelWithMap,
  normalizeProviderChannelBaseUrl,
  supportsProviderChannels,
} from "@/lib/provider-channels";
import { serializeProviderError } from "@/lib/providers/diagnostics";
import { modelProtocolToProviderProtocol } from "@/lib/providers/protocols";
import {
  assertGenerationQueueReady,
  enqueueGeneration,
  generationQueueStats,
} from "@/lib/queue";
import {
  ConcurrentLimitError,
  DailyLimitError,
  ModerationRejectionLimitError,
  assertGenerationAllowed,
  assertModerationRejectionAllowed,
  recordModerationRejectionAttempt,
} from "@/lib/rate-limit";
import { RedisUnavailableError } from "@/lib/redis";
import { isDatabaseUnavailableError } from "@/lib/service-errors";

class InsufficientCreditsError extends Error {
  constructor() {
    super("点数不足");
    this.name = "InsufficientCreditsError";
  }
}

class ConversationNotFoundError extends Error {
  constructor() {
    super("对话不存在");
    this.name = "ConversationNotFoundError";
  }
}

function generationServiceUnavailable() {
  return fail("SERVICE_UNAVAILABLE", "生成服务暂时不可用", { status: 503 });
}

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "生成服务未配置数据库", { status: 503 });
  }

  if (sessionResult.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  if (sessionResult.status === "unauthenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  try {
    const session = sessionResult.user;
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(Number(searchParams.get("limit") ?? 20), 1),
      50,
    );
    const cursor = searchParams.get("cursor");
    const status = searchParams.get("status");
    const [rows, displayNameMap] = await Promise.all([
      db.generation.findMany({
        where: {
          userId: session.id,
          deletedAt: null,
          ...(isGenerationStatus(status) ? { status } : {}),
        },
        include: {
          images: true,
          provider: {
            select: {
              id: true,
              name: true,
            },
          },
          providerAccount: {
            select: {
              id: true,
              name: true,
              baseUrl: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: limit + 1,
      }),
      getProviderChannelDisplayNameMap(),
    ]);
    const items = rows.slice(0, limit);

    return ok({
      items: items.map((item) => serializeGeneration(item, { displayNameMap })),
      nextCursor: rows.length > limit ? rows[limit]?.id : null,
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return generationServiceUnavailable();
    }

    return fail("INTERNAL_ERROR", "生成记录读取失败", {
      status: 500,
    });
  }
}

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
  const json = (await request.json()) as unknown;
  const parsed = generationRequestSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "请求参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  try {
    const model = await getModelWithPricing(parsed.data.modelId);

    if (!model) {
      return fail("MODEL_NOT_AVAILABLE", "当前模型不可用", { status: 404 });
    }

    const internalRequest = validateAgainstModelDefinition(parsed.data, model);
    const normalizedRequestParams = {
      ...parsed.data,
      providerChannelId: internalRequest.providerChannelId,
    };

    if (!process.env.DATABASE_URL) {
      return fail("SERVICE_UNAVAILABLE", "生成服务未配置数据库", {
        status: 503,
      });
    }

    if (sessionResult.status === "unavailable") {
      return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
    }

    if (sessionResult.status === "unauthenticated") {
      return fail("UNAUTHORIZED", "请先登录", { status: 401 });
    }

    const session = sessionResult.user;
    const estimatedCredits = estimateCost(model, internalRequest);
    const pricingSnapshot = createPricingSnapshot(
      model,
      internalRequest,
      estimatedCredits,
    );
    const pricingSnapshotJson =
      pricingSnapshot as unknown as Prisma.InputJsonObject;
    const conversationId = parsed.data.conversationId;
    const providerChannelId = internalRequest.providerChannelId;
    const displayNameMap = await getProviderChannelDisplayNameMap();
    let selectedProviderChannel:
      | {
          baseUrl: string;
          displayName: string | null;
        }
      | null = null;

    if (supportsProviderChannels(internalRequest.modelId) && providerChannelId) {
      const modelIds = supportedModelIds(internalRequest.modelId);
      const candidateAccounts = await db.providerAccount.findMany({
        where: {
          isActive: true,
          health: { not: "DOWN" },
          OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: new Date() } }],
          provider: {
            isActive: true,
            health: { not: "DOWN" },
            protocol: modelProtocolToProviderProtocol(internalRequest.protocol),
            OR: modelIds.map((id) => ({ modelsSupported: { has: id } })),
          },
        },
        include: {
          provider: {
            select: {
              name: true,
            },
          },
        },
      });
      const selectedAccount = candidateAccounts.find((account) =>
        providerChannelMatchesBaseUrl(providerChannelId, account.baseUrl),
      );

      if (!selectedAccount) {
        return fail("PROVIDER_CHANNEL_NOT_FOUND", "该大渠道暂不可用", {
          status: 503,
        });
      }

      const baseUrl = normalizeProviderChannelBaseUrl(selectedAccount.baseUrl);
      selectedProviderChannel = baseUrl
        ? {
            baseUrl,
            displayName: displayNameForProviderChannelWithMap(
              selectedAccount.baseUrl,
              selectedAccount.provider.name,
              displayNameMap,
            ),
          }
        : null;
      Object.assign(normalizedRequestParams, {
        providerChannelBaseUrl: selectedProviderChannel?.baseUrl,
        providerChannelName: selectedProviderChannel?.displayName,
      });
    }

    await assertProviderAvailable(
      internalRequest.modelId,
      internalRequest.providerChannelId,
    );
    await assertGenerationQueueReady();
    await assertGenerationAllowed(session.id);
    await assertModerationRejectionAllowed(session.id);

    const combinedPrompt = [
      internalRequest.prompt,
      internalRequest.negativePrompt,
    ]
      .filter(Boolean)
      .join("\n");
    const sourceReferenceImages = parsed.data.sourceImageIds?.length
      ? await db.generatedImage.findMany({
          where: {
            id: {
              in: parsed.data.sourceImageIds,
            },
            generation: {
              userId: session.id,
              deletedAt: null,
            },
          },
          select: {
            storageKey: true,
            mimeType: true,
          },
        })
      : [];

    if (
      (parsed.data.sourceImageIds?.length ?? 0) !== sourceReferenceImages.length
    ) {
      return fail("REFERENCE_IMAGE_NOT_FOUND", "参考图不存在或不可用", {
        status: 404,
      });
    }

    if (sourceReferenceImages.length) {
      if (!model.capabilities.supportsReferenceImage) {
        return fail("UNSUPPORTED_PARAM", "当前模型不支持参考图", {
          status: 400,
        });
      }

      internalRequest.referenceImages = [
        ...(internalRequest.referenceImages ?? []),
        ...sourceReferenceImages.map((image) => ({
          key: image.storageKey,
          mimeType: image.mimeType,
        })),
      ];
    }

    if (
      (internalRequest.referenceImages?.length ?? 0) >
      model.capabilities.maxReferenceImages
    ) {
      return fail(
        "UNSUPPORTED_PARAM",
        `参考图最多 ${model.capabilities.maxReferenceImages} 张`,
        { status: 400 },
      );
    }

    if (await isPromptBlocked(combinedPrompt)) {
      await recordModerationRejectionAttempt(request.headers);

      await db.usageLog.create({
        data: {
          userId: session.id,
          modelId: internalRequest.modelId,
          action: "moderation_rejected",
          creditsDelta: 0,
          metadata: {
            reason: "blocked_keyword",
          },
        },
      });

      return fail("MODERATION_REJECTED", "提示词包含不允许的内容", {
        status: 400,
      });
    }

    const user = await db.user.findUnique({
      where: { id: session.id },
      select: { credits: true },
    });

    if (!user || user.credits < estimatedCredits) {
      return fail("INSUFFICIENT_CREDITS", "点数不足", { status: 402 });
    }

    const generation = await db.$transaction(async (tx) => {
      if (conversationId) {
        const conversation = await tx.conversation.findFirst({
          where: {
            id: conversationId,
            userId: session.id,
            archivedAt: null,
          },
          select: {
            id: true,
          },
        });

        if (!conversation) {
          throw new ConversationNotFoundError();
        }
      }

      const created = await tx.generation.create({
        data: {
          userId: session.id,
          conversationId,
          modelId: internalRequest.modelId,
          prompt: internalRequest.prompt,
          negativePrompt: internalRequest.negativePrompt,
          aspectRatio: internalRequest.aspectRatio,
          resolution: internalRequest.resolution,
          n: internalRequest.n,
          seed:
            internalRequest.seed === undefined
              ? undefined
              : BigInt(internalRequest.seed),
          outputFormat: internalRequest.outputFormat,
          paramsRaw: normalizedRequestParams,
          referenceImageKeys: [
            ...(parsed.data.referenceImageKeys ?? []),
            ...sourceReferenceImages.map((image) => image.storageKey),
          ],
          status: "PENDING",
          progress: 0,
          costCredits: estimatedCredits,
          pricingSnapshot: pricingSnapshotJson,
        },
      });

      if (conversationId) {
        if (parsed.data.userMessage?.trim()) {
          await tx.conversationMessage.create({
            data: {
              conversationId,
              role: "USER",
              content: parsed.data.userMessage.trim(),
            },
          });
        }

        if (parsed.data.assistantMessage?.trim()) {
          await tx.conversationMessage.create({
            data: {
              conversationId,
              role: "ASSISTANT",
              content: parsed.data.assistantMessage.trim(),
              generationId: created.id,
            },
          });
        }

        await tx.conversation.update({
          where: { id: conversationId },
          data: {
            lastMessageAt: new Date(),
          },
        });
      }

      const debited = await tx.user.updateMany({
        where: {
          id: session.id,
          credits: {
            gte: estimatedCredits,
          },
        },
        data: {
          credits: {
            decrement: estimatedCredits,
          },
        },
      });

      if (debited.count === 0) {
        throw new InsufficientCreditsError();
      }

      await tx.usageLog.create({
        data: {
          userId: session.id,
          generationId: created.id,
          modelId: internalRequest.modelId,
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
        userId: session.id,
        request: internalRequest,
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
          where: { id: session.id },
          data: {
            credits: {
              increment: estimatedCredits,
            },
          },
        }),
        db.usageLog.create({
          data: {
            userId: session.id,
            generationId: generation.id,
            modelId: internalRequest.modelId,
            action: "refund",
            creditsDelta: estimatedCredits,
            metadata: {
              reason: "queue_failed",
            },
          },
        }),
      ]);

      logger.error(
        { generationId: generation.id, error: serializeProviderError(error) },
        "Generation enqueue failed.",
      );

      return fail("QUEUE_UNAVAILABLE", "任务入队失败，已退还点数", {
        status: 503,
      });
    }

    const queueStats = await generationQueueStats().catch(() => null);

    return ok({
      generationId: generation.id,
      status: generation.status,
      estimatedCredits,
      providerChannelId: internalRequest.providerChannelId ?? null,
      queuePosition: queueStats?.waiting ?? 0,
      workerOnline: queueStats?.workerOnline ?? false,
      queueWaiting: queueStats?.waiting ?? 0,
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return generationServiceUnavailable();
    }

    if (
      error instanceof ValidationError ||
      error instanceof UnsupportedParamError
    ) {
      return fail("UNSUPPORTED_PARAM", error.message, { status: 400 });
    }

    if (error instanceof InsufficientCreditsError) {
      return fail("INSUFFICIENT_CREDITS", error.message, { status: 402 });
    }

    if (error instanceof ConversationNotFoundError) {
      return fail("CONVERSATION_NOT_FOUND", error.message, { status: 404 });
    }

    if (error instanceof ModelNotAvailableError) {
      return fail("MODEL_NOT_AVAILABLE", error.message, { status: 503 });
    }

    if (error instanceof ProviderUnavailableError) {
      return fail("PROVIDER_UNAVAILABLE", error.message, {
        status: 503,
      });
    }

    if (error instanceof RedisUnavailableError) {
      return fail("QUEUE_UNAVAILABLE", "任务队列暂不可用，请稍后重试", {
        status: 503,
      });
    }

    if (error instanceof ConcurrentLimitError) {
      return fail("CONCURRENT_LIMIT", error.message, { status: 429 });
    }

    if (error instanceof DailyLimitError) {
      return fail("RATE_LIMITED", error.message, { status: 429 });
    }

    if (error instanceof ModerationRejectionLimitError) {
      return fail("MODERATION_RATE_LIMITED", error.message, { status: 429 });
    }

    return fail("INTERNAL_ERROR", "生成请求处理失败", {
      status: 500,
    });
  }
}
