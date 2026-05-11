import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { getModel } from "@/lib/models/registry";
import type { InternalRequest } from "@/lib/models/types";
import { serializeProviderError } from "@/lib/providers/diagnostics";
import { buildAdapter } from "@/lib/providers/factory";
import { providerProtocolToModelProtocol } from "@/lib/providers/protocols";

function smokeRequestForModel(modelId: string): InternalRequest | null {
  const model = getModel(modelId);

  if (!model) {
    return null;
  }

  return {
    modelId: model.id,
    protocol: model.protocol,
    prompt: "A small black square on a plain white background.",
    aspectRatio: model.defaults.aspectRatio,
    resolution: model.capabilities.resolutions.includes("1K")
      ? "1K"
      : model.defaults.resolution,
    n: 1,
    outputFormat: model.defaults.outputFormat,
    background: model.defaults.background,
    outputCompression: model.defaults.outputCompression,
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  const { id } = await context.params;
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (sessionResult.status !== "authenticated") {
    return fail("UNAUTHORIZED", "缺少管理员身份", { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "渠道服务未配置数据库", { status: 503 });
  }

  const admin = authenticatedUser(sessionResult);

  const provider = await db.provider.findUnique({
    where: { id },
  });

  if (!provider) {
    return fail("NOT_FOUND", "渠道不存在", { status: 404 });
  }

  const requestBody = smokeRequestForModel(provider.modelsSupported[0]);

  if (!requestBody) {
    return fail("VALIDATION_ERROR", "渠道没有可测试的模型", { status: 400 });
  }

  const adapter = buildAdapter({
    id: provider.id,
    name: provider.name,
    protocol: providerProtocolToModelProtocol(provider.protocol),
    baseUrl: provider.baseUrl,
    apiKey: decrypt(provider.apiKeyEnc),
  });

  try {
    const result = await adapter.generate(
      requestBody,
      AbortSignal.timeout(90_000),
    );

    await db.provider.update({
      where: { id },
      data: {
        health: "HEALTHY",
        consecutiveErrors: 0,
        lastHealthyAt: new Date(),
      },
    });
    await audit({
      actorId: admin.id,
      action: "admin.provider.test",
      target: id,
      diff: {
        ok: true,
        modelId: requestBody.modelId,
        imageCount: result.images.length,
      },
      request,
    });

    return ok({
      health: "HEALTHY",
      modelId: requestBody.modelId,
      imageCount: result.images.length,
    });
  } catch (error) {
    const diagnostic = serializeProviderError(error);

    await db.provider.update({
      where: { id },
      data: {
        health: "DEGRADED",
        consecutiveErrors: {
          increment: 1,
        },
        lastErrorAt: new Date(),
        lastErrorMsg: diagnostic.slice(0, 500),
      },
    });
    await audit({
      actorId: admin.id,
      action: "admin.provider.test",
      target: id,
      diff: { ok: false, modelId: requestBody.modelId, error: diagnostic },
      request,
    });

    return fail("PROVIDER_ERROR", "渠道测试失败", {
      status: 502,
      details: diagnostic,
    });
  }
}
