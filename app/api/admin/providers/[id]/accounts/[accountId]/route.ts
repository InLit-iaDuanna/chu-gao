import { createHash } from "node:crypto";

import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { normalizeProviderBaseUrl } from "@/lib/providers/protocols";
import { providerAccountPatchSchema } from "@/lib/validators";

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function PATCH(
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

  const json = (await request.json()) as unknown;
  const parsed = providerAccountPatchSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "账号参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const current = await db.providerAccount.findFirst({
    where: { id: accountId, providerId: id },
    include: { provider: { select: { protocol: true } } },
  });

  if (!current) {
    return fail("NOT_FOUND", "账号不存在", { status: 404 });
  }

  const admin = authenticatedUser(sessionResult);
  const account = await db.providerAccount.update({
    where: { id: accountId },
    data: {
      name: parsed.data.name,
      baseUrl: parsed.data.baseUrl
        ? normalizeProviderBaseUrl(parsed.data.baseUrl, current.provider.protocol)
        : undefined,
      apiKeyEnc: parsed.data.apiKey ? encrypt(parsed.data.apiKey) : undefined,
      apiKeyFingerprint: parsed.data.apiKey
        ? fingerprint(parsed.data.apiKey)
        : undefined,
      priority: parsed.data.priority,
      weight: parsed.data.weight,
      maxConcurrency: parsed.data.maxConcurrency,
      dailyLimit: parsed.data.dailyLimit,
      isActive: parsed.data.isActive,
      health: parsed.data.health,
      cooldownUntil: parsed.data.cooldownUntil
        ? new Date(parsed.data.cooldownUntil)
        : parsed.data.cooldownUntil === null
          ? null
          : undefined,
      note: parsed.data.note,
    },
  });

  await audit({
    actorId: admin.id,
    action: "admin.provider_account.update",
    target: accountId,
    diff: {
      ...parsed.data,
      apiKey: parsed.data.apiKey ? "***" : undefined,
    },
    request,
  });

  return ok({ ...account, apiKeyEnc: undefined, hasApiKey: true });
}

export async function DELETE(
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

  const admin = authenticatedUser(sessionResult);
  const account = await db.providerAccount.updateMany({
    where: { id: accountId, providerId: id },
    data: {
      isActive: false,
      health: "DOWN",
    },
  });

  if (account.count === 0) {
    return fail("NOT_FOUND", "账号不存在", { status: 404 });
  }

  await audit({
    actorId: admin.id,
    action: "admin.provider_account.disable",
    target: accountId,
    diff: { isActive: false, health: "DOWN" },
    request,
  });

  return ok({ id: accountId, isActive: false, health: "DOWN" });
}
