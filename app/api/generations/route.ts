import type { Prisma } from "@prisma/client";
import { ChatTurnError } from "@/lib/chat-turns";

import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { creativeAssistantEnabled } from "@/lib/creative-config";
import { creativePrompt, creativeReferenceRequest } from "@/lib/creative-brief";
import {
  findGenerationOperation,
  generationOperation,
  GenerationOperationConflictError,
} from "@/lib/generation-operation";
import { estimateCost } from "@/lib/credits";
import { db } from "@/lib/db";
import {
  ConversationNotFoundError,
  GenerationQueueError,
  InsufficientCreditsError,
  createAndEnqueueGeneration,
  isGenerationStatus,
  serializeGeneration,
} from "@/lib/generations";
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
import { modelProtocolToProviderProtocol } from "@/lib/providers/protocols";
import { assertGenerationQueueReady, generationQueueStats } from "@/lib/queue";
import {
  ConcurrentLimitError,
  DailyLimitError,
  ModerationRejectionLimitError,
  assertModerationRejectionAllowed,
  recordModerationRejectionAttempt,
} from "@/lib/rate-limit";
import { RedisUnavailableError } from "@/lib/redis";
import { readJsonBodySafe } from "@/lib/request-body";
import { isDatabaseUnavailableError } from "@/lib/service-errors";
import { normalizeUploadedReferenceKey } from "@/lib/storage";

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
          // API-key jobs return their images to the caller and keep none here.
          apiKeyId: null,
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

export async function DELETE(request: Request) {
  const sessionResult = await checkSession(request);

  if (sessionResult.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  if (sessionResult.status === "unauthenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "生成服务未配置数据库", {
      status: 503,
    });
  }

  try {
    const cleared = await db.generation.updateMany({
      where: {
        userId: sessionResult.user.id,
        deletedAt: null,
        status: { in: ["SUCCEEDED", "FAILED", "CANCELED"] },
      },
      data: { deletedAt: new Date() },
    });

    return ok({ cleared: cleared.count });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return generationServiceUnavailable();
    }

    throw error;
  }
}

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status === "unavailable")
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  if (sessionResult.status === "unauthenticated")
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const body = await readJsonBodySafe(request);

  if (!body.ok) {
    return body.response;
  }

  const json = body.data;
  const parsed = generationRequestSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "请求参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  try {
    const creative = parsed.data.creative;
    if (creative) {
      if (!creativeAssistantEnabled())
        return fail("FEATURE_DISABLED", "辅助创作暂未开放", { status: 503 });
      if (parsed.data.n !== 1)
        return fail("VALIDATION_ERROR", "辅助创作每次确认生成一张", {
          status: 400,
        });
      Object.assign(parsed.data, {
        prompt: creativePrompt(creative.brief, Boolean(creative.baseReference)),
        negativePrompt: undefined,
        ...creativeReferenceRequest(creative.baseReference),
      });
    }
    const operation = creative
      ? generationOperation(creative.operationId, parsed.data)
      : undefined;
    if (operation) {
      const replay = await findGenerationOperation(
        sessionResult.user.id,
        operation,
      );
      if (replay)
        return ok({
          ...replay,
          providerChannelId: parsed.data.providerChannelId ?? null,
          queuePosition: 0,
          workerOnline: false,
          queueWaiting: 0,
        });
    }
    const model = await getModelWithPricing(parsed.data.modelId);

    if (!model) {
      return fail("MODEL_NOT_AVAILABLE", "当前模型不可用", { status: 404 });
    }

    const internalRequest = validateAgainstModelDefinition(parsed.data, model);
    const normalizedRequestParams = {
      ...parsed.data,
      providerChannelId: internalRequest.providerChannelId,
      size: internalRequest.size,
      responseFormat: internalRequest.responseFormat,
    };

    if (!process.env.DATABASE_URL) {
      return fail("SERVICE_UNAVAILABLE", "生成服务未配置数据库", {
        status: 503,
      });
    }

    const session = sessionResult.user;
    if (
      parsed.data.referenceImageKeys?.some((key) => {
        const normalized = normalizeUploadedReferenceKey(key);
        return !normalized || !normalized.startsWith(`uploads/${session.id}/`);
      })
    ) {
      return fail("REFERENCE_IMAGE_NOT_FOUND", "参考图不存在或不可用", {
        status: 404,
      });
    }
    const conversationId = parsed.data.conversationId;
    const providerChannelId = internalRequest.providerChannelId;
    const displayNameMap = await getProviderChannelDisplayNameMap();
    let selectedProviderChannel: {
      baseUrl: string;
      displayName: string | null;
    } | null = null;

    if (
      supportsProviderChannels(internalRequest.modelId) &&
      providerChannelId
    ) {
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
              id: true,
              name: true,
            },
          },
        },
      });
      const selectedAccount = candidateAccounts.find((account) =>
        providerChannelMatchesBaseUrl(
          providerChannelId,
          account.baseUrl,
          account.provider.id,
        ),
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
    await assertModerationRejectionAllowed(session.id);

    const combinedPrompt = [
      internalRequest.prompt,
      internalRequest.negativePrompt,
    ]
      .filter(Boolean)
      .join("\n");
    const sourceImageIds = parsed.data.sourceImageIds ?? [];
    const sourceImages = sourceImageIds.length
      ? await db.generatedImage.findMany({
          where: {
            id: {
              in: sourceImageIds,
            },
            generation: {
              userId: session.id,
              deletedAt: null,
            },
          },
          select: {
            id: true,
            storageKey: true,
            mimeType: true,
          },
        })
      : [];

    const sourceImagesById = new Map(
      sourceImages.map((image) => [image.id, image]),
    );
    if (
      sourceImageIds.length !== sourceImages.length ||
      sourceImageIds.some((id) => !sourceImagesById.has(id))
    ) {
      return fail("REFERENCE_IMAGE_NOT_FOUND", "参考图不存在或不可用", {
        status: 404,
      });
    }

    // SQL IN does not preserve selection order. Keep the same reference order
    // in the provider request and the persisted recovery/retry data.
    const sourceReferenceImages = sourceImageIds.map(
      (id) => sourceImagesById.get(id)!,
    );
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

    const estimatedCredits = estimateCost(model, internalRequest);
    if (creative && estimatedCredits > creative.maxCredits) {
      return fail("PRICE_CHANGED", "生成费用已变化，请重新确认费用", {
        status: 409,
      });
    }
    const pricingSnapshot = createPricingSnapshot(
      model,
      internalRequest,
      estimatedCredits,
    );
    const pricingSnapshotJson =
      pricingSnapshot as unknown as Prisma.InputJsonObject;

    if (await isPromptBlocked(combinedPrompt)) {
      await recordModerationRejectionAttempt(
        session.id,
        internalRequest.modelId,
        {
          reason: "blocked_keyword",
        },
      );

      return fail("MODERATION_REJECTED", "提示词包含不允许的内容", {
        status: 400,
      });
    }

    if (!operation) {
      const user = await db.user.findUnique({
        where: { id: session.id },
        select: { credits: true },
      });
      if (!user || user.credits < estimatedCredits) {
        return fail("INSUFFICIENT_CREDITS", "点数不足", { status: 402 });
      }
    }

    const {
      generationId,
      status,
      estimatedCredits: acceptedCredits,
    } = await createAndEnqueueGeneration({
      userId: session.id,
      operation,
      request: internalRequest,
      normalizedRequestParams,
      estimatedCredits,
      pricingSnapshotJson,
      conversationId,
      referenceImageKeys: (() => {
        const order = parsed.data.referenceOrder;
        const uploadKeys = parsed.data.referenceImageKeys ?? [];
        const sourceStorageKeys = sourceReferenceImages.map((img) => img.storageKey);
        if (!order?.length) {
          // Legacy: uploads first, then source images.
          return [...uploadKeys, ...sourceStorageKeys];
        }
        // Reconstruct the ordered list the client specified.
        const uploadById = new Map(uploadKeys.map((k) => [k, k]));
        const sourceById = new Map(
          sourceReferenceImages.map((img) => [img.id, img.storageKey]),
        );
        const ordered: string[] = [];
        for (const token of order) {
          const [kind, key] = token.split(":", 2) as [string, string];
          if (kind === "upload") {
            const resolved = uploadById.get(key);
            if (resolved) ordered.push(resolved);
          } else if (kind === "source") {
            const resolved = sourceById.get(key);
            if (resolved) ordered.push(resolved);
          }
        }
        // Append any keys not mentioned in the order (shouldn't happen but safe).
        const seen = new Set(ordered);
        for (const k of [...uploadKeys, ...sourceStorageKeys]) {
          if (!seen.has(k)) ordered.push(k);
        }
        return ordered;
      })(),
      userMessage: parsed.data.userMessage,
      assistantMessage: parsed.data.assistantMessage,
    });

    const queueStats = await generationQueueStats().catch(() => null);

    return ok({
      generationId,
      status,
      estimatedCredits: acceptedCredits ?? estimatedCredits,
      providerChannelId: null,
      queuePosition: queueStats?.waiting ?? 0,
      workerOnline: queueStats?.workerOnline ?? false,
      queueWaiting: queueStats?.waiting ?? 0,
    });
  } catch (error) {
    if (error instanceof GenerationOperationConflictError)
      return fail("OPERATION_CONFLICT", error.message, { status: 409 });
    if (error instanceof ChatTurnError)
      return fail(error.code, error.message, { status: error.status });
    if (isDatabaseUnavailableError(error)) {
      return generationServiceUnavailable();
    }

    if (error instanceof GenerationQueueError) {
      return fail("QUEUE_UNAVAILABLE", error.message, { status: 503 });
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
