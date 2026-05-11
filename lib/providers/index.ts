import type { Provider, ProviderAccount, ProviderHealth } from "@prisma/client";

import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { getModel } from "@/lib/models/registry";
import type { InternalRequest } from "@/lib/models/types";
import {
  ProviderRequestError,
  serializeProviderError,
} from "@/lib/providers/diagnostics";
import { buildAdapter } from "@/lib/providers/factory";
import {
  modelProtocolToProviderProtocol,
  providerProtocolToModelProtocol,
} from "@/lib/providers/protocols";
import type { GenerateResult } from "@/lib/providers/types";

type ProviderTarget = {
  provider: Provider;
  account: ProviderAccount | null;
};

export class ModelNotAvailableError extends Error {
  constructor(modelId: string) {
    super(`模型 ${modelId} 当前没有可用渠道`);
    this.name = "ModelNotAvailableError";
  }
}

export class ProviderUnavailableError extends Error {
  constructor(
    modelId: string,
    readonly cause?: unknown,
  ) {
    super(`模型 ${modelId} 的渠道暂不可用`);
    this.name = "ProviderUnavailableError";
  }
}

function isDowngradable(error: unknown): boolean {
  if (error instanceof ProviderRequestError) {
    return error.diagnostic.status === 429 || error.diagnostic.status >= 500;
  }

  const message = serializeProviderError(error);

  if (
    message.includes("Provider error: 429") ||
    message.includes("request failed: 429")
  ) {
    return true;
  }

  if (
    message.includes("Provider error: 5") ||
    /request failed: 5\d\d/.test(message)
  ) {
    return true;
  }

  if (message.includes("超时")) {
    return true;
  }

  return false;
}

function isRateLimited(error: unknown): boolean {
  if (error instanceof ProviderRequestError) {
    return error.diagnostic.status === 429;
  }

  const message = serializeProviderError(error);
  return (
    message.includes("Provider error: 429") ||
    message.includes("request failed: 429")
  );
}

async function markHealthy(providerId: string): Promise<void> {
  await db.provider.update({
    where: { id: providerId },
    data: {
      consecutiveErrors: 0,
      health: "HEALTHY",
      lastHealthyAt: new Date(),
    },
  });
}

async function markAccountHealthy(accountId: string): Promise<void> {
  await db.providerAccount.update({
    where: { id: accountId },
    data: {
      consecutiveErrors: 0,
      health: "HEALTHY",
      cooldownUntil: null,
      lastHealthyAt: new Date(),
    },
  });
}

async function markErrored(
  providerId: string,
  error: unknown,
  downgradable: boolean,
): Promise<void> {
  const provider = await db.provider.findUnique({
    where: { id: providerId },
    select: {
      consecutiveErrors: true,
      health: true,
    },
  });

  if (!provider) {
    return;
  }

  const nextErrors = provider.consecutiveErrors + 1;
  let health: ProviderHealth = provider.health;

  if (downgradable) {
    if (nextErrors >= 5) {
      health = "DOWN";
    } else if (nextErrors >= 3) {
      health = "DEGRADED";
    }
  }

  await db.provider.update({
    where: { id: providerId },
    data: {
      consecutiveErrors: nextErrors,
      health,
      lastErrorAt: new Date(),
      lastErrorMsg: serializeProviderError(error).slice(0, 500),
    },
  });
}

async function markAccountErrored(
  accountId: string,
  error: unknown,
  downgradable: boolean,
): Promise<void> {
  const account = await db.providerAccount.findUnique({
    where: { id: accountId },
    select: {
      consecutiveErrors: true,
      health: true,
    },
  });

  if (!account) {
    return;
  }

  const nextErrors = account.consecutiveErrors + 1;
  let health: ProviderHealth = account.health;

  if (downgradable) {
    if (nextErrors >= 5) {
      health = "DOWN";
    } else if (nextErrors >= 3) {
      health = "DEGRADED";
    }
  }

  await db.providerAccount.update({
    where: { id: accountId },
    data: {
      consecutiveErrors: nextErrors,
      health,
      cooldownUntil: isRateLimited(error)
        ? new Date(Date.now() + 5 * 60_000)
        : undefined,
      lastErrorAt: new Date(),
      lastErrorMsg: serializeProviderError(error).slice(0, 500),
    },
  });
}

async function releaseAccountLease(accountId: string): Promise<void> {
  await db.providerAccount.updateMany({
    where: {
      id: accountId,
      inFlight: { gt: 0 },
    },
    data: {
      inFlight: {
        decrement: 1,
      },
    },
  });
}

async function leaseProviderAccount(
  account: ProviderAccount & { provider: Provider },
): Promise<ProviderTarget | null> {
  const leased = await db.providerAccount.updateMany({
    where: {
      id: account.id,
      isActive: true,
      health: { not: "DOWN" },
      inFlight: { lt: account.maxConcurrency },
      OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: new Date() } }],
    },
    data: {
      inFlight: {
        increment: 1,
      },
      lastLeaseAt: new Date(),
    },
  });

  if (leased.count === 0) {
    return null;
  }

  return {
    provider: account.provider,
    account,
  };
}

async function findAvailableProviderAccounts(modelId: string) {
  const model = getModel(modelId);

  if (!model || !process.env.DATABASE_URL) {
    return [];
  }

  const now = new Date();

  return db.providerAccount.findMany({
    where: {
      isActive: true,
      health: { not: "DOWN" },
      inFlight: {
        lt: db.providerAccount.fields.maxConcurrency,
      },
      OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }],
      provider: {
        isActive: true,
        protocol: modelProtocolToProviderProtocol(model.protocol),
        modelsSupported: {
          has: modelId,
        },
        health: {
          not: "DOWN",
        },
      },
    },
    include: {
      provider: true,
    },
    orderBy: [
      { provider: { priority: "desc" } },
      { priority: "desc" },
      { inFlight: "asc" },
      { lastLeaseAt: "asc" },
      { createdAt: "asc" },
    ],
  });
}

export async function selectAndGenerate(
  request: InternalRequest,
): Promise<{
  result: GenerateResult;
  providerId: string;
  providerAccountId: string | null;
  multiplier: number;
}> {
  if (!process.env.DATABASE_URL) {
    throw new ProviderUnavailableError(request.modelId);
  }

  const accountCandidates = await findAvailableProviderAccounts(request.modelId);
  const legacyCandidates = await findAvailableProviders(request.modelId);

  if (accountCandidates.length === 0 && legacyCandidates.length === 0) {
    throw new ModelNotAvailableError(request.modelId);
  }

  const errors: unknown[] = [];

  for (const account of accountCandidates) {
    const target = await leaseProviderAccount(account);

    if (!target) {
      continue;
    }

    const adapter = buildAdapter({
      id: target.account?.id ?? target.provider.id,
      name: target.account?.name ?? target.provider.name,
      protocol: providerProtocolToModelProtocol(target.provider.protocol),
      baseUrl: target.account?.baseUrl ?? target.provider.baseUrl,
      apiKey: decrypt(target.account?.apiKeyEnc ?? target.provider.apiKeyEnc),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);

    try {
      const result = await adapter.generate(request, controller.signal);
      clearTimeout(timer);
      await Promise.all([
        markHealthy(target.provider.id),
        target.account ? markAccountHealthy(target.account.id) : Promise.resolve(),
      ]);

      return {
        result,
        providerId: target.provider.id,
        providerAccountId: target.account?.id ?? null,
        multiplier: target.provider.costMultiplier,
      };
    } catch (error) {
      clearTimeout(timer);
      const downgradable = isDowngradable(error);
      errors.push(error);
      await Promise.all([
        markErrored(target.provider.id, error, downgradable),
        target.account
          ? markAccountErrored(target.account.id, error, downgradable)
          : Promise.resolve(),
      ]);

      if (!downgradable) {
        throw error;
      }
    } finally {
      if (target.account) {
        await releaseAccountLease(target.account.id);
      }
    }
  }

  for (const provider of legacyCandidates) {
    const hasAccounts = await db.providerAccount.count({
      where: { providerId: provider.id },
    });

    if (hasAccounts > 0) {
      continue;
    }

    const adapter = buildAdapter({
      id: provider.id,
      name: provider.name,
      protocol: providerProtocolToModelProtocol(provider.protocol),
      baseUrl: provider.baseUrl,
      apiKey: decrypt(provider.apiKeyEnc),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);

    try {
      const result = await adapter.generate(request, controller.signal);
      clearTimeout(timer);
      await markHealthy(provider.id);

      return {
        result,
        providerId: provider.id,
        providerAccountId: null,
        multiplier: provider.costMultiplier,
      };
    } catch (error) {
      clearTimeout(timer);
      const downgradable = isDowngradable(error);
      errors.push(error);
      await markErrored(provider.id, error, downgradable);

      if (!downgradable) {
        throw error;
      }
    }
  }

  throw new ProviderUnavailableError(
    request.modelId,
    new Error(
      `所有渠道均不可用: ${errors.map(serializeProviderError).join("; ")}`,
    ),
  );
}

export async function findAvailableProviders(modelId: string) {
  const model = getModel(modelId);

  if (!model || !process.env.DATABASE_URL) {
    return [];
  }

  return db.provider.findMany({
    where: {
      isActive: true,
      protocol: modelProtocolToProviderProtocol(model.protocol),
      modelsSupported: {
        has: modelId,
      },
      health: {
        not: "DOWN",
      },
    },
    orderBy: {
      priority: "desc",
    },
  });
}

export async function assertProviderAvailable(modelId: string): Promise<void> {
  const [accounts, providers] = await Promise.all([
    findAvailableProviderAccounts(modelId),
    findAvailableProviders(modelId),
  ]);
  const legacyProviders = await Promise.all(
    providers.map(async (provider) => ({
      provider,
      accountCount: await db.providerAccount.count({
        where: { providerId: provider.id },
      }),
    })),
  );

  if (
    accounts.length === 0 &&
    legacyProviders.every((item) => item.accountCount > 0)
  ) {
    throw new ModelNotAvailableError(modelId);
  }
}
