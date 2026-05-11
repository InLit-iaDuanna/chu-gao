import { createHash } from "node:crypto";

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
import { providerSchema } from "@/lib/validators";

function validateProviderModels(
  protocol: ProviderProtocol,
  modelIds: string[],
): string | null {
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

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
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

  try {
    const providers = await db.provider.findMany({
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      include: {
        accounts: true,
      },
    });

    return ok(providers.map(serializeProvider));
  } catch (error) {
    return fail("INTERNAL_ERROR", "渠道列表读取失败", {
      status: 500,
      details: error instanceof Error ? error.message : "unknown",
    });
  }
}

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "渠道服务未配置数据库", { status: 503 });
  }

  const admin = authenticatedUser(sessionResult);

  const json = (await request.json()) as unknown;
  const parsed = providerSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "渠道参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const protocolError = validateProviderModels(
    parsed.data.protocol,
    parsed.data.modelsSupported,
  );

  if (protocolError) {
    return fail("VALIDATION_ERROR", protocolError, { status: 400 });
  }

  try {
    const baseUrl = normalizeProviderBaseUrl(
      parsed.data.baseUrl,
      parsed.data.protocol,
    );
    const provider = await db.provider.create({
      data: {
        name: parsed.data.name,
        protocol: parsed.data.protocol,
        baseUrl,
        apiKeyEnc: encrypt(parsed.data.apiKey),
        priority: parsed.data.priority,
        modelsSupported: parsed.data.modelsSupported,
        costMultiplier: parsed.data.costMultiplier,
        note: parsed.data.note,
        accounts: {
          create: {
            name: `${parsed.data.name} 默认账号`,
            baseUrl,
            apiKeyEnc: encrypt(parsed.data.apiKey),
            apiKeyFingerprint: fingerprint(parsed.data.apiKey),
            maxConcurrency: 1,
          },
        },
      },
      include: { accounts: true },
    });
    await audit({
      actorId: admin.id,
      action: "admin.provider.create",
      target: provider.id,
      diff: {
        ...parsed.data,
        baseUrl,
        apiKey: "***",
      },
      request,
    });

    return ok(serializeProvider(provider), { status: 201 });
  } catch (error) {
    return fail("INTERNAL_ERROR", "渠道创建失败", {
      status: 500,
      details: error instanceof Error ? error.message : "unknown",
    });
  }
}
