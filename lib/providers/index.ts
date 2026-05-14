import type { Provider, ProviderAccount, ProviderHealth } from "@prisma/client";

import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { getModel } from "@/lib/models/registry";
import type { InternalRequest } from "@/lib/models/types";
import {
  getImage2ProviderChannel,
  isImage2ModelId,
  normalizeProviderChannelBaseUrl,
} from "@/lib/provider-channels";
import {
  ProviderRequestError,
  isProviderTimeoutError,
  isUpstreamAccessForbiddenError,
  serializeProviderError,
} from "@/lib/providers/diagnostics";
import { buildAdapter } from "@/lib/providers/factory";
import {
  generationTimeoutMs,
  providerAccountMaxAttempts,
} from "@/lib/providers/config";
import {
  modelProtocolToProviderProtocol,
  providerProtocolToModelProtocol,
} from "@/lib/providers/protocols";
import type {
  GenerateProgressCallback,
  GenerateResult,
} from "@/lib/providers/types";

type ProviderTarget = {
  provider: Provider;
  account: ProviderAccount | null;
};

function supportedModelIds(modelId: string): string[] {
  if (modelId === "gemini-3.1-flash-image-preview") {
    return [modelId, "gemini-2.5-flash-image"];
  }

  if (modelId === "gemini-3-pro-image-preview") {
    return [modelId, "gemini-2.5-flash-image-pro"];
  }

  return [modelId];
}

type ProviderFailureDetails = {
  accountAttempts?: number;
  maxAccountAttempts?: number;
};

function accountReliabilityScore(
  account: ProviderAccount & { provider: Provider },
): number {
  let score = 0;

  if (account.lastHealthyAt) {
    score += 10_000;
  }

  if (account.lastErrorMsg?.includes("访问被拒绝")) {
    score -= 5_000;
  }

  if (account.lastErrorMsg?.includes("Upstream access forbidden")) {
    score -= 5_000;
  }

  if (account.lastErrorMsg?.includes("502 Bad Gateway")) {
    score -= 1_000;
  }

  score -= account.consecutiveErrors * 500;
  score += account.weight * 10;

  return score;
}

export class ModelNotAvailableError extends Error {
  constructor(modelId: string, channelLabel?: string | null) {
    super(
      channelLabel
        ? `${channelLabel} 暂不可用`
        : `模型 ${modelId} 当前没有可用渠道`,
    );
    this.name = "ModelNotAvailableError";
  }
}

export class ProviderUnavailableError extends Error {
  constructor(
    modelId: string,
    readonly channelLabel?: string | null,
    readonly cause?: unknown,
    readonly details?: ProviderFailureDetails,
  ) {
    super(channelLabel ? `${channelLabel} 暂不可用` : `模型 ${modelId} 的渠道暂不可用`);
    this.name = "ProviderUnavailableError";
  }
}

function isDowngradable(error: unknown): boolean {
  if (isProviderTimeoutError(error)) {
    return true;
  }

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

function isAuthenticationError(error: unknown): boolean {
  if (error instanceof ProviderRequestError) {
    return (
      error.diagnostic.status === 401 ||
      error.diagnostic.status === 403 ||
      error.diagnostic.status === 404
    );
  }

  const message = serializeProviderError(error);
  return (
    message.includes("Provider error: 401") ||
    message.includes("Provider error: 403") ||
    message.includes("Provider error: 404") ||
    message.includes("request failed: 401") ||
    message.includes("request failed: 403") ||
    message.includes("request failed: 404")
  );
}

function isFatalAccountError(error: unknown): boolean {
  return isAuthenticationError(error) || isUpstreamAccessForbiddenError(error);
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

async function markProviderPoolErrored(
  providerId: string,
  errors: unknown[],
): Promise<void> {
  if (errors.length === 0) {
    return;
  }

  await markErrored(
    providerId,
    new Error(
      `账号池本轮尝试失败（${errors.length} 个账号）: ${errors
        .map(serializeProviderError)
        .join("; ")}`,
    ),
    true,
  );
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

  if (isFatalAccountError(error)) {
    health = "DOWN";
  }

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
      cooldownUntil:
        isRateLimited(error) || isFatalAccountError(error)
          ? new Date(Date.now() + 5 * 60_000)
          : downgradable
            ? new Date(Date.now() + 60_000)
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

async function findAvailableProviderAccounts(
  modelId: string,
  providerChannelId?: string,
) {
  const model = getModel(modelId);

  if (!model || !process.env.DATABASE_URL) {
    return [];
  }

  const now = new Date();
  const modelIds = supportedModelIds(modelId);
  const channel = isImage2ModelId(modelId)
    ? getImage2ProviderChannel(providerChannelId)
    : null;
  const channelBaseUrl = normalizeProviderChannelBaseUrl(channel?.baseUrl);

  const accounts = await db.providerAccount.findMany({
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
        OR: modelIds.map((id) => ({ modelsSupported: { has: id } })),
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

  return accounts
    .filter(
      (account) =>
        !channelBaseUrl ||
        normalizeProviderChannelBaseUrl(account.baseUrl) === channelBaseUrl,
    )
    .sort((left, right) => {
      const leftProviderPriority = left.provider.priority;
      const rightProviderPriority = right.provider.priority;

      if (rightProviderPriority !== leftProviderPriority) {
        return rightProviderPriority - leftProviderPriority;
      }

      if (right.priority !== left.priority) {
        return right.priority - left.priority;
      }

      const leftReliability = accountReliabilityScore(left);
      const rightReliability = accountReliabilityScore(right);

      if (rightReliability !== leftReliability) {
        return rightReliability - leftReliability;
      }

      const leftFreeSlots = left.maxConcurrency - left.inFlight;
      const rightFreeSlots = right.maxConcurrency - right.inFlight;

      if (rightFreeSlots !== leftFreeSlots) {
        return rightFreeSlots - leftFreeSlots;
      }

      if (right.weight !== left.weight) {
        return right.weight - left.weight;
      }

      if (left.inFlight !== right.inFlight) {
        return left.inFlight - right.inFlight;
      }

      const leftLease = left.lastLeaseAt?.getTime() ?? 0;
      const rightLease = right.lastLeaseAt?.getTime() ?? 0;

      return leftLease - rightLease;
    });
}

function maxAttemptsForAccounts(
  accounts: Array<ProviderAccount & { provider: Provider }>,
  providerChannel: ReturnType<typeof getImage2ProviderChannel>,
): number {
  if (!providerChannel) {
    return Math.min(providerAccountMaxAttempts(), accounts.length);
  }

  const successfulAccountCount = accounts.filter(
    (account) => account.lastHealthyAt,
  ).length;

  return Math.min(
    accounts.length,
    Math.max(providerAccountMaxAttempts(), successfulAccountCount, 12),
  );
}

export async function selectAndGenerate(
  request: InternalRequest,
  options?: {
    onProviderSelected?: (selection: {
      providerId: string;
      providerName: string;
      providerAccountId: string | null;
      providerAccountName: string | null;
    }) => Promise<void> | void;
    onProgress?: GenerateProgressCallback;
  },
): Promise<{
  result: GenerateResult;
  providerId: string;
  providerName: string;
  providerAccountId: string | null;
  providerAccountName: string | null;
  multiplier: number;
}> {
  if (!process.env.DATABASE_URL) {
    throw new ProviderUnavailableError(request.modelId);
  }

  const accountCandidates = await findAvailableProviderAccounts(
    request.modelId,
    request.providerChannelId,
  );
  const providerChannel = isImage2ModelId(request.modelId)
    ? getImage2ProviderChannel(request.providerChannelId)
    : null;
  const legacyCandidates = await findAvailableProviders(request.modelId);

  if (accountCandidates.length === 0 && legacyCandidates.length === 0) {
    throw new ModelNotAvailableError(
      request.modelId,
      providerChannel?.displayName ?? null,
    );
  }

  const errors: unknown[] = [];
  const providerPoolErrors = new Map<string, unknown[]>();
  let accountAttempts = 0;
  const filteredAccountCandidates = providerChannel
    ? accountCandidates.filter(
        (account) =>
          normalizeProviderChannelBaseUrl(account.baseUrl) ===
          normalizeProviderChannelBaseUrl(providerChannel.baseUrl),
      )
    : accountCandidates;
  const maxAccountAttempts = maxAttemptsForAccounts(
    filteredAccountCandidates,
    providerChannel,
  );

  for (const account of filteredAccountCandidates) {
    if (accountAttempts >= maxAccountAttempts) {
      break;
    }

    const target = await leaseProviderAccount(account);

    if (!target) {
      continue;
    }

    if (!target.account) {
      continue;
    }

    accountAttempts += 1;

    const adapter = buildAdapter({
      id: target.account?.id ?? target.provider.id,
      name: target.account?.name ?? target.provider.name,
      protocol: providerProtocolToModelProtocol(target.provider.protocol),
      baseUrl: target.account?.baseUrl ?? target.provider.baseUrl,
      apiKey: decrypt(target.account?.apiKeyEnc ?? target.provider.apiKeyEnc),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), generationTimeoutMs());

    try {
      await options?.onProviderSelected?.({
        providerId: target.provider.id,
        providerName: target.provider.name,
        providerAccountId: target.account?.id ?? null,
        providerAccountName: target.account?.name ?? null,
      });
      const result = await adapter.generate(
        request,
        controller.signal,
        options?.onProgress,
      );
      clearTimeout(timer);
      await Promise.all([
        markHealthy(target.provider.id),
        target.account ? markAccountHealthy(target.account.id) : Promise.resolve(),
      ]);

      return {
        result,
        providerId: target.provider.id,
        providerName: target.provider.name,
        providerAccountId: target.account?.id ?? null,
        providerAccountName: target.account?.name ?? null,
        multiplier: target.provider.costMultiplier,
      };
    } catch (error) {
      clearTimeout(timer);
      const downgradable = isDowngradable(error);
      errors.push(error);
      const providerErrors = providerPoolErrors.get(target.provider.id) ?? [];
      providerErrors.push(error);
      providerPoolErrors.set(target.provider.id, providerErrors);

      await markAccountErrored(target.account.id, error, downgradable);

      if (!downgradable && !isFatalAccountError(error)) {
        throw error;
      }
    } finally {
      if (target.account) {
        await releaseAccountLease(target.account.id);
      }
    }
  }

  await Promise.all(
    Array.from(providerPoolErrors.entries()).map(([providerId, providerErrors]) =>
      markProviderPoolErrored(providerId, providerErrors),
    ),
  );

  for (const provider of providerChannel ? [] : legacyCandidates) {
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
    const timer = setTimeout(() => controller.abort(), generationTimeoutMs());

    try {
      await options?.onProviderSelected?.({
        providerId: provider.id,
        providerName: provider.name,
        providerAccountId: null,
        providerAccountName: null,
      });
      const result = await adapter.generate(
        request,
        controller.signal,
        options?.onProgress,
      );
      clearTimeout(timer);
      await markHealthy(provider.id);

      return {
        result,
        providerId: provider.id,
        providerName: provider.name,
        providerAccountId: null,
        providerAccountName: null,
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
    providerChannel?.displayName ?? null,
    new Error(
      `所有渠道均不可用: ${errors.map(serializeProviderError).join("; ")}`,
    ),
    {
      accountAttempts,
      maxAccountAttempts,
    },
  );
}

export async function findAvailableProviders(modelId: string) {
  const model = getModel(modelId);

  if (!model || !process.env.DATABASE_URL) {
    return [];
  }

  const modelIds = supportedModelIds(modelId);

  return db.provider.findMany({
    where: {
      isActive: true,
      protocol: modelProtocolToProviderProtocol(model.protocol),
      OR: modelIds.map((id) => ({ modelsSupported: { has: id } })),
      health: {
        not: "DOWN",
      },
    },
    orderBy: {
      priority: "desc",
    },
  });
}

export async function assertProviderAvailable(
  modelId: string,
  providerChannelId?: string,
): Promise<void> {
  const [accounts, providers] = await Promise.all([
    findAvailableProviderAccounts(modelId, providerChannelId),
    findAvailableProviders(modelId),
  ]);
  const providerChannel = isImage2ModelId(modelId)
    ? getImage2ProviderChannel(providerChannelId)
    : null;
  const legacyProviders = await Promise.all(
    (providerChannel ? [] : providers).map(async (provider) => ({
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
    throw new ModelNotAvailableError(
      modelId,
      providerChannel?.displayName ?? null,
    );
  }
}
