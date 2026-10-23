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
import { getApiKeyRuntimeConfig } from "@/lib/api-key-pricing";
import {
  applyApiPricing,
  getApiPriceTable,
  resolveApiPriceList,
  type ApiPriceTable,
} from "@/lib/api-pricing";
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
  saveUploadedReferenceImage,
  statPrivateStorageKey,
} from "@/lib/storage";

/**
 * Download a caller-supplied reference image URL, validate it, and persist it
 * as a user upload so the rest of the pipeline can use it identically to an
 * explicitly uploaded file.  The upstream URL is never forwarded to callers.
 */
async function downloadAndSaveReferenceImageUrl(
  url: string,
  userId: string,
): Promise<string> {
  let buf: Buffer;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const ab = await resp.arrayBuffer();
    buf = Buffer.from(ab);
  } catch (err) {
    throw new AgentAuthError(
      "REFERENCE_IMAGE_FETCH_FAILED",
      `参考图 URL 无法访问：${err instanceof Error ? err.message : "网络错误"}`,
      400,
    );
  }
  const ct = (await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5_000) }).catch(() => null))?.headers.get("content-type") ?? "";
  const mimeType =
    ct.includes("jpeg") || ct.includes("jpg")
      ? "image/jpeg"
      : ct.includes("webp")
        ? "image/webp"
        : "image/png";
  try {
    const saved = await saveUploadedReferenceImage({ buffer: buf, mimeType, userId });
    return saved.storageKey;
  } catch {
    throw new AgentAuthError(
      "REFERENCE_IMAGE_FETCH_FAILED",
      "参考图 URL 内容无效，请检查图片格式",
      400,
    );
  }
}

import { z } from "zod";
import { IMAGE_QUALITY_OPTIONS } from "@/lib/models/options";

// Accepted effort labels that map to quality values.
const EFFORT_TO_QUALITY: Record<string, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

function normalizeApiInput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  // `effort` is an alias for `quality`; if both are present `quality` wins.
  if (obj.effort !== undefined && obj.quality === undefined) {
    const mapped = EFFORT_TO_QUALITY[String(obj.effort)];
    if (mapped) obj.quality = mapped;
  }
  delete obj.effort;
  // `image_url` is an alias for a single referenceImageUrl
  if (typeof obj.image_url === "string" && !obj.referenceImageUrls) {
    obj.referenceImageUrls = [obj.image_url];
  }
  delete obj.image_url;
  // `images` as array of URL strings or {image_url: string}
  if (Array.isArray(obj.images) && !obj.referenceImageUrls) {
    obj.referenceImageUrls = (obj.images as unknown[]).map((item) =>
      typeof item === "string" ? item : (item as Record<string, string>).image_url ?? "",
    ).filter(Boolean);
  }
  delete obj.images;
  return obj;
}

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
  .extend({
    n: generationRequestSchema.shape.n.default(1),
    // Inline reference images via URL (downloaded server-side, never forwarded as-is).
    referenceImageUrls: z.array(z.url()).max(16).optional(),
  })
  .strict();

export function preprocessAgentInput(raw: unknown): unknown {
  return normalizeApiInput(raw);
}

/**
 * Model catalog for v1 callers. API-key callers see the API price list
 * (`prices`, per image by resolution); agent tokens keep the web pricing data.
 */
export async function agentModels(forApiKey = false) {
  const [models, apiPrices, runtime] = await Promise.all([
    listModelsWithPricing(),
    forApiKey ? getApiPriceTable() : Promise.resolve<ApiPriceTable>({}),
    forApiKey ? getApiKeyRuntimeConfig() : Promise.resolve(null),
  ]);
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
      const base = {
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
      };
      if (runtime) {
        return {
          ...base,
          prices: resolveApiPriceList(
            model,
            apiPrices[model.id],
            runtime.creditMultiplier,
          ),
        };
      }
      return {
        ...base,
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
  const parsed = agentGenerationSchema.safeParse(preprocessAgentInput(body));
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
  // Download any inline URL references first; they become first-class uploads.
  const urlKeys: string[] = [];
  for (const url of input.referenceImageUrls ?? []) {
    const key = await downloadAndSaveReferenceImageUrl(url, sp.user.id);
    urlKeys.push(key);
  }

  const referenceKeys = [...urlKeys, ...(input.referenceImageKeys ?? [])];
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
  // API-key calls are billed from the API price list. The re-priced snapshot
  // is what worker settlement reads, so the final charge stays on API prices.
  const webSnapshot = createPricingSnapshot(model, request);
  const pricingSnapshot = resolvedApiKeyId
    ? applyApiPricing(
        webSnapshot,
        (await getApiPriceTable())[model.id],
        (await getApiKeyRuntimeConfig()).creditMultiplier,
        { resolution: request.resolution, n: request.n },
      )
    : webSnapshot;
  const estimatedCredits = pricingSnapshot.estimatedCredits;
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
    pricingSnapshotJson: pricingSnapshot as unknown as Prisma.InputJsonObject,
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

type AgentGenerationRow = Prisma.GenerationGetPayload<{
  include: { images: true };
}>;

/** Public v1 shape for a generation; shared by the detail and list routes. */
export function serializeAgentGeneration(row: AgentGenerationRow) {
  return {
    id: row.id,
    modelId: row.modelId,
    status: row.status,
    progress: row.progress,
    costCredits: row.costCredits,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    errorCode: row.errorCode
      ? /MODERATION|CONTENT|SAFETY|UNSAFE/.test(row.errorCode)
        ? "MODERATION_REJECTED"
        : row.status === "CANCELED"
          ? "CANCELED"
          : "GENERATION_FAILED"
      : null,
    errorMessage: publicAgentFailure(row.errorCode),
    images: row.images.map(({ id, width, height, mimeType }) => ({
      id,
      width,
      height,
      mimeType,
    })),
  };
}

const LIST_STATUSES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
] as const;
type ListStatus = (typeof LIST_STATUSES)[number];

/**
 * List the caller's API/agent generations, newest first. When the caller is
 * an API key, only that key's generations are returned.
 */
export async function listAgentGenerations(
  principal: SubmissionPrincipal,
  params: { limit: number; cursor?: string; status?: string },
) {
  const status = LIST_STATUSES.includes(params.status as ListStatus)
    ? (params.status as ListStatus)
    : undefined;
  const rows = await db.generation.findMany({
    where: {
      userId: principal.user.id,
      deletedAt: null,
      ...(principal.apiKeyId
        ? { apiKeyId: principal.apiKeyId }
        : {
            OR: [
              { agentAuthorizationId: { not: null } },
              { apiKeyId: { not: null } },
            ],
          }),
      ...(status ? { status } : {}),
    },
    include: { images: { orderBy: { createdAt: "asc" } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;
  return {
    items: page.map(serializeAgentGeneration),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
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
