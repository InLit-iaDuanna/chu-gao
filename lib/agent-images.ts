import type { Prisma } from "@prisma/client";
import {
  AgentAuthError,
  assertAgentSubmission,
  bindAgentRead,
  type AgentPrincipal,
} from "@/lib/agent-auth";
import { fail } from "@/lib/api-response";

/** Lightweight principal accepted by submitAgentGeneration. Works for both
 *  Agent Bearer tokens and API keys. */
export type SubmissionPrincipal = {
  user: { id: string; email: string; credits: number };
  agentAuthorizationId?: string;
  apiKeyId?: string;
};

function toSubmissionPrincipal(p: AgentPrincipal): SubmissionPrincipal {
  return {
    user: p.user,
    agentAuthorizationId: p.authorization.id,
  };
}
import { db } from "@/lib/db";
import { estimateCost } from "@/lib/credits";
import {
  createPricingSnapshot,
  getModelWithPricing,
  listModelsWithPricing,
} from "@/lib/model-pricing";
import {
  generationRequestSchema,
  validateAgainstModelDefinition,
  ValidationError,
  UnsupportedParamError,
} from "@/lib/models/validate";
import {
  createAndEnqueueGeneration,
  GenerationQueueError,
  InsufficientCreditsError,
} from "@/lib/generations";
import {
  generationOperation,
  findGenerationOperation,
  GenerationOperationConflictError,
} from "@/lib/generation-operation";
import {
  assertProviderAvailable,
  ModelNotAvailableError,
  ProviderUnavailableError,
} from "@/lib/providers";
import { assertGenerationQueueReady } from "@/lib/queue";
import { isPromptBlocked } from "@/lib/moderation";
import {
  assertModerationRejectionAllowed,
  recordModerationRejectionAttempt,
  ConcurrentLimitError,
  DailyLimitError,
  ModerationRejectionLimitError,
} from "@/lib/rate-limit";
import {
  normalizeUploadedReferenceKey,
  statPrivateStorageKey,
} from "@/lib/storage";

export const agentGenerationSchema = generationRequestSchema
  .omit({
    creative: true,
    conversationId: true,
    userMessage: true,
    assistantMessage: true,
    providerChannelId: true,
    image2Mode: true,
    sourceImageIds: true,
  })
  .extend({ n: generationRequestSchema.shape.n.default(1) })
  .strict();

export async function agentModels() {
  const models = await listModelsWithPricing();
  return Promise.all(
    models.map(async (model) => {
      let available = false;
      try {
        await assertProviderAvailable(model.id);
        available = true;
      } catch {
        /* Report availability without exposing channel failures. */
      }
      const {
        responseFormats: _responseFormats,
        image2Modes: _modes,
        ...capabilities
      } = model.capabilities;
      return {
        id: model.id,
        displayName: model.displayName,
        available,
        capabilities,
        defaults: {
          size: model.defaults.size,
          quality: model.defaults.quality,
          outputFormat: model.defaults.outputFormat,
          background: model.defaults.background,
        },
        costAxis: model.costAxis,
        costTable: model.costTable,
        pricingRules: model.pricingRules
          ?.filter((rule) => !rule.providerChannelId)
          .map(({ providerChannelId: _channel, id: _id, ...rule }) => rule),
      };
    }),
  );
}

export async function submitAgentGeneration(
  principal: AgentPrincipal | SubmissionPrincipal,
  body: unknown,
  idempotencyKey: string | null,
  apiKeyId?: string,
) {
  // Normalize both principal shapes to SubmissionPrincipal
  const sp: SubmissionPrincipal =
    "authorization" in principal
      ? toSubmissionPrincipal(principal)
      : principal;
  const resolvedAgentAuthId = sp.agentAuthorizationId;
  const resolvedApiKeyId = apiKeyId ?? sp.apiKeyId;
  if (!idempotencyKey || !/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey))
    throw new AgentAuthError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "请提供 8 至 128 位 Idempotency-Key",
      400,
    );
  const parsed = agentGenerationSchema.safeParse(body);
  if (!parsed.success)
    throw new AgentAuthError(
      "VALIDATION_ERROR",
      "生图参数无效或包含不支持的字段",
      400,
    );
  const input = parsed.data;
  const operation = generationOperation(`agent:${idempotencyKey}`, input);
  const replay = await findGenerationOperation(sp.user.id, operation);
  if (replay) {
    if (resolvedAgentAuthId) {
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sp.user.id})::bigint)`;
        const grant = await assertAgentSubmission(
          tx,
          resolvedAgentAuthId,
          sp.user.id,
          replay.generationId,
        );
        if (grant.mode === "single" && !grant.boundGenerationId)
          await tx.agentAuthorization.update({
            where: { id: grant.id },
            data: { boundGenerationId: replay.generationId },
          });
      });
    }
    return replay;
  }
  const model = await getModelWithPricing(input.modelId);
  if (!model)
    throw new AgentAuthError("MODEL_NOT_AVAILABLE", "模型不存在或已停用", 400);
  const request = validateAgainstModelDefinition(input, model);
  // Keep the upstream's base64 preference independent of the external API result transport.
  if (model.capabilities.responseFormats.includes("b64_json"))
    request.responseFormat = "b64_json";
  const referenceKeys = input.referenceImageKeys ?? [];
  for (const key of referenceKeys) {
    const normalized = normalizeUploadedReferenceKey(key);
    if (!normalized || !normalized.startsWith(`uploads/${sp.user.id}/`))
      throw new AgentAuthError(
        "REFERENCE_IMAGE_NOT_FOUND",
        "参考图不存在或不可用",
        404,
      );
    try {
      await statPrivateStorageKey(normalized);
    } catch {
      throw new AgentAuthError(
        "REFERENCE_IMAGE_NOT_FOUND",
        "参考图已过期或不可用，请重新上传",
        404,
      );
    }
  }
  await assertProviderAvailable(request.modelId);
  await assertGenerationQueueReady();
  await assertModerationRejectionAllowed(sp.user.id);
  if (
    await isPromptBlocked(
      [request.prompt, request.negativePrompt].filter(Boolean).join("\n"),
    )
  ) {
    await recordModerationRejectionAttempt(sp.user.id, request.modelId, {
      reason: "blocked_keyword",
    });
    throw new AgentAuthError(
      "MODERATION_REJECTED",
      "提示词或参考图未通过内容审核，请调整后重试",
      400,
    );
  }
  const estimatedCredits = estimateCost(model, request);
  return createAndEnqueueGeneration({
    userId: sp.user.id,
    agentAuthorizationId: resolvedAgentAuthId,
    apiKeyId: resolvedApiKeyId,
    operation,
    request,
    normalizedRequestParams: {
      ...input,
      size: request.size,
      quality: request.quality,
      responseFormat: request.responseFormat,
    },
    estimatedCredits,
    pricingSnapshotJson: createPricingSnapshot(
      model,
      request,
      estimatedCredits,
    ) as unknown as Prisma.InputJsonObject,
    referenceImageKeys: referenceKeys,
  });
}

export async function ownedAgentGeneration(
  principal: AgentPrincipal | SubmissionPrincipal,
  id: string,
) {
  const userId =
    "authorization" in principal ? principal.user.id : principal.user.id;
  const row = await db.generation.findFirst({
    where: {
      id,
      userId,
      OR: [
        { agentAuthorizationId: { not: null } },
        { apiKeyId: { not: null } },
      ],
      deletedAt: null,
    },
    include: { images: { orderBy: { createdAt: "asc" } } },
  });
  if (!row) throw new AgentAuthError("NOT_FOUND", "任务不存在或已过期", 404);
  // Only run single-use grant binding when request came via agent auth
  if ("authorization" in principal) {
    await bindAgentRead(principal, row.id);
  }
  return row;
}

export function publicAgentFailure(code: string | null) {
  if (!code) return null;
  if (/MODERATION|CONTENT|SAFETY|UNSAFE/.test(code))
    return "提示词或参考图未通过内容审核，请调整后重试";
  if (/CANCEL/.test(code)) return "任务已取消";
  if (/TIMEOUT|TIMED_OUT|STUCK/.test(code)) return "生成超时，请稍后再试";
  return "生成失败，积分将按实际结果结算，请查看积分流水";
}

export function agentImageErrorResponse(error: unknown) {
  if (error instanceof AgentAuthError)
    return fail(error.code, error.message, { status: error.status });
  if (error instanceof GenerationOperationConflictError)
    return fail(
      "IDEMPOTENCY_CONFLICT",
      "该任务标识已用于不同参数，请恢复原任务或使用新的任务标识",
      { status: 409 },
    );
  if (
    error instanceof ValidationError ||
    error instanceof UnsupportedParamError
  )
    return fail("UNSUPPORTED_PARAM", error.message, { status: 400 });
  if (error instanceof InsufficientCreditsError)
    return fail("INSUFFICIENT_CREDITS", "积分不足", { status: 402 });
  if (error instanceof GenerationQueueError)
    return fail(
      "QUEUE_UNAVAILABLE",
      "任务未能入队，已退还积分；请使用相同任务标识查询结果",
      { status: 503 },
    );
  if (
    error instanceof ConcurrentLimitError ||
    error instanceof DailyLimitError ||
    error instanceof ModerationRejectionLimitError
  )
    return fail("RATE_LIMITED", error.message, { status: 429 });
  if (
    error instanceof ModelNotAvailableError ||
    error instanceof ProviderUnavailableError
  )
    return fail("MODEL_NOT_AVAILABLE", "模型暂不可用，请稍后重试", {
      status: 503,
    });
  return fail(
    "SERVICE_UNAVAILABLE",
    "生成服务暂不可用，请使用相同任务标识恢复",
    { status: 503 },
  );
}
