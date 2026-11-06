import { checkSession } from "@/lib/auth";
import { creativeAssistantEnabled } from "@/lib/creative-config";
import { fail, ok } from "@/lib/api-response";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import {
  creativeBriefSchema,
  creativePrompt,
  creativeReferenceRequest,
  creativeReferenceSchema,
} from "@/lib/creative-brief";
import { estimateCost } from "@/lib/credits";
import { db } from "@/lib/db";
import { getModelWithPricing } from "@/lib/model-pricing";
import {
  generationRequestSchema,
  validateAgainstModelDefinition,
} from "@/lib/models/validate";
import { readJsonBodySafe } from "@/lib/request-body";
import {
  normalizeUploadedReferenceKey,
  statPrivateStorageKey,
} from "@/lib/storage";

const schema = generationRequestSchema
  .pick({ modelId: true, size: true, outputFormat: true })
  .extend({
    brief: creativeBriefSchema,
    baseReference: creativeReferenceSchema.nullable(),
  });

export async function POST(request: Request) {
  if (!creativeAssistantEnabled())
    return fail("FEATURE_DISABLED", "辅助创作暂未开放", { status: 503 });
  const session = await checkSession(request);
  if (session.status !== "authenticated")
    return fail("UNAUTHORIZED", "请重新登录后重试", {
      status: session.status === "unavailable" ? 503 : 401,
    });
  const limited = await userActionRateLimitResponse(
    session.user.id,
    "creative-quote",
    undefined,
    30,
  );
  if (limited) return limited;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success || !parsed.data.brief.goal.trim())
    return fail("VALIDATION_ERROR", "请填写完整的创作目标", { status: 400 });
  try {
    const { baseReference, brief } = parsed.data;
    const model = await getModelWithPricing(parsed.data.modelId);
    if (!model)
      return fail("MODEL_NOT_AVAILABLE", "当前模型不可用", { status: 404 });
    const input = validateAgainstModelDefinition(
      {
        ...parsed.data,
        n: 1,
        prompt: creativePrompt(brief, Boolean(baseReference)),
        ...creativeReferenceRequest(baseReference),
      },
      model,
    );
    if (baseReference) {
      if (!model.capabilities.supportsReferenceImage)
        return fail("UNSUPPORTED_PARAM", "当前模型不支持基图", { status: 400 });
      let key: string | null = null;
      if (baseReference.kind === "source") {
        const image = await db.generatedImage.findFirst({
          where: {
            id: baseReference.key,
            generation: { userId: session.user.id, deletedAt: null },
          },
          select: { storageKey: true, mimeType: true },
        });
        if (image) {
          key = image.storageKey;
          input.referenceImages = [{ key, mimeType: image.mimeType }];
        }
      } else {
        const normalized = normalizeUploadedReferenceKey(baseReference.key);
        if (normalized?.startsWith(`uploads/${session.user.id}/`))
          key = normalized;
      }
      if (!key)
        return fail("REFERENCE_IMAGE_NOT_FOUND", "基图不存在或不可用", {
          status: 404,
        });
      await statPrivateStorageKey(key);
    }
    return ok({
      estimatedCredits: estimateCost(model, input),
      prompt: input.prompt,
    });
  } catch {
    return fail(
      "QUOTE_UNAVAILABLE",
      "暂时无法确认费用，请检查模型、尺寸和基图后重试",
      { status: 400 },
    );
  }
}
