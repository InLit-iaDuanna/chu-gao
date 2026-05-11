import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { modelsByProtocol } from "@/lib/models/registry";
import { buildAdapter } from "@/lib/providers/factory";
import { providerProtocolToModelProtocol } from "@/lib/providers/protocols";
import { serializeProviderError } from "@/lib/providers/diagnostics";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; accountId: string }> },
) {
  const sessionResult = await checkSession(request);
  const { id, accountId } = await context.params;
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "号池服务未配置数据库", { status: 503 });
  }

  const account = await db.providerAccount.findFirst({
    where: { id: accountId, providerId: id },
    include: { provider: true },
  });

  if (!account) {
    return fail("NOT_FOUND", "账号不存在", { status: 404 });
  }

  const modelProtocol = providerProtocolToModelProtocol(account.provider.protocol);
  const model = modelsByProtocol(modelProtocol).find((item) =>
    account.provider.modelsSupported.includes(item.id),
  );

  if (!model) {
    return fail("VALIDATION_ERROR", "渠道池没有可测试的模型", { status: 400 });
  }

  const adapter = buildAdapter({
    id: account.id,
    name: account.name ?? account.provider.name,
    protocol: modelProtocol,
    baseUrl: account.baseUrl,
    apiKey: decrypt(account.apiKeyEnc),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  const admin = authenticatedUser(sessionResult);

  try {
    await adapter.generate(
      {
        modelId: model.id,
        protocol: model.protocol,
        prompt: "health check",
        aspectRatio: model.defaults.aspectRatio,
        resolution: model.defaults.resolution,
        n: 1,
        outputFormat: model.defaults.outputFormat,
        background: model.defaults.background,
      },
      controller.signal,
    );
    clearTimeout(timer);

    const updated = await db.providerAccount.update({
      where: { id: account.id },
      data: {
        health: "HEALTHY",
        consecutiveErrors: 0,
        cooldownUntil: null,
        lastHealthyAt: new Date(),
      },
    });

    await audit({
      actorId: admin.id,
      action: "admin.provider_account.test",
      target: account.id,
      diff: { ok: true },
      request,
    });

    return ok({ ok: true, accountId: updated.id, health: updated.health });
  } catch (error) {
    clearTimeout(timer);
    const updated = await db.providerAccount.update({
      where: { id: account.id },
      data: {
        health: "DEGRADED",
        consecutiveErrors: { increment: 1 },
        lastErrorAt: new Date(),
        lastErrorMsg: serializeProviderError(error).slice(0, 500),
      },
    });

    await audit({
      actorId: admin.id,
      action: "admin.provider_account.test",
      target: account.id,
      diff: { ok: false, error: updated.lastErrorMsg },
      request,
    });

    return fail("PROVIDER_TEST_FAILED", "账号测试失败", {
      status: 502,
      details: updated.lastErrorMsg,
    });
  }
}
