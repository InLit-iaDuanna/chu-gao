import type { ProviderProtocol } from "@prisma/client";

import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { getModel } from "@/lib/models/registry";
import {
  normalizeProviderBaseUrl,
  providerProtocolToModelProtocol,
} from "@/lib/providers/protocols";
import { serializeProvider } from "@/lib/providers/serialize";
import { providerPatchSchema } from "@/lib/validators";

function validateProviderModels(
  protocol: ProviderProtocol,
  modelIds: string[] | undefined,
): string | null {
  if (!modelIds) {
    return null;
  }

  const expectedProtocol = providerProtocolToModelProtocol(protocol);

  for (const modelId of modelIds) {
    const model = getModel(modelId);

    if (!model) {
      return `未知模型 ${modelId}`;
    }

    if (model.protocol !== expectedProtocol) {
      return `模型 ${modelId} 与协议 ${protocol} 不匹配`;
    }
  }

  return null;
}

export async function GET(
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

  const provider = await db.provider.findUnique({
    where: { id },
    include: { accounts: true },
  });

  if (!provider) {
    return fail("NOT_FOUND", "渠道不存在", { status: 404 });
  }

  return ok(serializeProvider(provider));
}

export async function PATCH(
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

  const json = (await request.json()) as unknown;
  const parsed = providerPatchSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "渠道参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const current = await db.provider.findUnique({
    where: { id },
  });

  if (!current) {
    return fail("NOT_FOUND", "渠道不存在", { status: 404 });
  }

  const protocol = parsed.data.protocol ?? current.protocol;
  const modelError = validateProviderModels(
    protocol,
    parsed.data.modelsSupported,
  );

  if (modelError) {
    return fail("VALIDATION_ERROR", modelError, { status: 400 });
  }

  const provider = await db.provider.update({
    where: { id },
    data: {
      name: parsed.data.name,
      protocol: parsed.data.protocol,
      baseUrl: parsed.data.baseUrl
        ? normalizeProviderBaseUrl(parsed.data.baseUrl, protocol)
        : undefined,
      apiKeyEnc: parsed.data.apiKey ? encrypt(parsed.data.apiKey) : undefined,
      priority: parsed.data.priority,
      modelsSupported: parsed.data.modelsSupported,
      costMultiplier: parsed.data.costMultiplier,
      note: parsed.data.note,
    },
    include: { accounts: true },
  });

  await audit({
    actorId: admin.id,
    action: "admin.provider.update",
    target: id,
    diff: {
      ...parsed.data,
      baseUrl: parsed.data.baseUrl
        ? normalizeProviderBaseUrl(parsed.data.baseUrl, protocol)
        : undefined,
      apiKey: parsed.data.apiKey ? "***" : undefined,
    },
    request,
  });

  return ok(serializeProvider(provider));
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  const { id } = await context.params;
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "渠道服务未配置数据库", { status: 503 });
  }

  const admin = authenticatedUser(sessionResult);

  const provider = await db.provider.update({
    where: { id },
    data: {
      isActive: false,
      health: "DOWN",
    },
    select: {
      id: true,
      isActive: true,
      health: true,
    },
  });

  await audit({
    actorId: admin.id,
    action: "admin.provider.disable",
    target: id,
    diff: { isActive: false, health: "DOWN" },
    request,
  });

  return ok(provider);
}
