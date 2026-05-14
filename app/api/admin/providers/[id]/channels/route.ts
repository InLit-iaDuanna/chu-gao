import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { setProviderChannelDisplayName } from "@/lib/provider-channel-config";
import { normalizeProviderBaseUrl } from "@/lib/providers/protocols";
import {
  providerChannelDeleteSchema,
  providerChannelPatchSchema,
} from "@/lib/validators";

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

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "渠道服务未配置数据库", { status: 503 });
  }

  const json = (await request.json()) as unknown;
  const parsed = providerChannelPatchSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "渠道参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const provider = await db.provider.findUnique({
    where: { id },
    select: {
      id: true,
      protocol: true,
    },
  });

  if (!provider) {
    return fail("NOT_FOUND", "渠道池不存在", { status: 404 });
  }

  const baseUrl = normalizeProviderBaseUrl(
    parsed.data.baseUrl,
    provider.protocol,
  );
  const accounts = await db.providerAccount.findMany({
    where: {
      providerId: id,
      baseUrl,
    },
    select: {
      id: true,
      maxConcurrency: true,
      isActive: true,
    },
    orderBy: [{ isActive: "desc" }, { priority: "desc" }, { createdAt: "asc" }],
  });

  if (accounts.length === 0) {
    return fail("NOT_FOUND", "这个大渠道下没有账号", { status: 404 });
  }

  const admin = authenticatedUser(sessionResult);
  const activeAccounts = accounts.filter((account) => account.isActive);
  const concurrencyAccounts =
    activeAccounts.length > 0 ? activeAccounts : accounts;
  const nextMaxConcurrency = parsed.data.maxConcurrency;

  if (
    nextMaxConcurrency !== undefined &&
    nextMaxConcurrency < concurrencyAccounts.length
  ) {
    return fail(
      "VALIDATION_ERROR",
      `总并发不能小于账号数 ${concurrencyAccounts.length}`,
      { status: 400 },
    );
  }

  const concurrencyUpdates =
    nextMaxConcurrency === undefined
      ? []
      : concurrencyAccounts.map((account, index) => {
          const base = Math.floor(
            nextMaxConcurrency / concurrencyAccounts.length,
          );
          const remainder = nextMaxConcurrency % concurrencyAccounts.length;

          return db.providerAccount.update({
            where: { id: account.id },
            data: {
              maxConcurrency: base + (index < remainder ? 1 : 0),
            },
          });
        });

  await Promise.all([
    parsed.data.displayName
      ? setProviderChannelDisplayName(baseUrl, parsed.data.displayName)
      : Promise.resolve(),
    ...concurrencyUpdates,
  ]);

  await audit({
    actorId: admin.id,
    action: "admin.provider_channel.update",
    target: id,
    diff: {
      baseUrl,
      displayName: parsed.data.displayName,
      maxConcurrency: nextMaxConcurrency,
    },
    request,
  });

  return ok({
    baseUrl,
    displayName: parsed.data.displayName,
    maxConcurrency: nextMaxConcurrency,
    updatedAccounts: concurrencyUpdates.length,
  });
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

  const json = (await request.json()) as unknown;
  const parsed = providerChannelDeleteSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "渠道参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const provider = await db.provider.findUnique({
    where: { id },
    select: {
      id: true,
      protocol: true,
    },
  });

  if (!provider) {
    return fail("NOT_FOUND", "渠道池不存在", { status: 404 });
  }

  const admin = authenticatedUser(sessionResult);
  const baseUrl = normalizeProviderBaseUrl(
    parsed.data.baseUrl,
    provider.protocol,
  );
  const result = await db.providerAccount.updateMany({
    where: {
      providerId: id,
      baseUrl,
    },
    data: {
      isActive: false,
      health: "DOWN",
      cooldownUntil: null,
      inFlight: 0,
    },
  });

  if (result.count === 0) {
    return fail("NOT_FOUND", "这个大渠道下没有账号", { status: 404 });
  }

  await audit({
    actorId: admin.id,
    action: "admin.provider_channel.disable",
    target: id,
    diff: {
      baseUrl,
      disabled: result.count,
    },
    request,
  });

  return ok({ baseUrl, disabled: result.count });
}
