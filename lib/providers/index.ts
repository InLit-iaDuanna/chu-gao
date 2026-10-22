import { decrypt } from "@/lib/crypto";
import { ProviderSubmissionUnknownError } from "@/lib/providers/single-submit";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getModel } from "@/lib/models/registry";
import type { InternalRequest } from "@/lib/models/types";
import {
  displayNameForProviderChannel,
  getImage2ProviderChannel,
} from "@/lib/provider-channels";
import { serializeProviderError } from "@/lib/providers/diagnostics";
import { buildAdapter } from "@/lib/providers/factory";
import { generationTimeoutMs } from "@/lib/providers/config";
import {
  modelProtocolToProviderProtocol,
  providerProtocolToModelProtocol,
} from "@/lib/providers/protocols";
import type {
  GenerateProgressCallback,
  GenerateResult,
} from "@/lib/providers/types";
import {
  findEligibleProviderAccounts,
  leaseProviderAccount,
  maxAttemptsForAccounts,
  releaseAccountLease,
  type ProviderLeaseContext,
} from "@/lib/providers/account-pool";
import {
  providerChannelMatchesBaseUrl,
  supportedModelIds,
} from "@/lib/providers/availability";
import {
  isDowngradable,
  isFatalAccountError,
  isRateLimited,
  providerRejectedError,
  shouldRecordProviderPoolError,
} from "@/lib/providers/failure-policy";
import {
  markAccountErrored,
  markAccountHealthy,
  markProviderErrored,
  markProviderHealthy,
  markProviderPoolErrored,
} from "@/lib/providers/health";
import {
  isChannelCircuitOpen,
  resetChannelCircuit,
  tripChannelCircuit,
} from "@/lib/providers/channel-circuit-breaker";

export { providerChannelMatchesBaseUrl, supportedModelIds };

type ProviderFailureDetails = {
  accountAttempts?: number;
  maxAccountAttempts?: number;
};

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
    super(
      channelLabel
        ? `${channelLabel} 暂不可用`
        : `模型 ${modelId} 的渠道暂不可用`,
    );
    this.name = "ProviderUnavailableError";
  }
}

/** A healthy provider exists, but all of its configured slots are busy. */
export class ProviderCapacityError extends Error {
  constructor(modelId: string, channelLabel?: string | null) {
    super(
      channelLabel
        ? `${channelLabel} 当前繁忙，任务将稍后重试`
        : `模型 ${modelId} 当前繁忙，任务将稍后重试`,
    );
    this.name = "ProviderCapacityError";
  }
}

export async function selectAndGenerate(
  request: InternalRequest,
  options?: {
    leaseContext?: ProviderLeaseContext;
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

  // Healthy but saturated accounts must remain candidates: saturation is a
  // queueing condition, not an outage. The atomic lease below decides which
  // job can start immediately.
  const accountCandidates = await findEligibleProviderAccounts(
    request.modelId,
    request.providerChannelId,
  );
  const providerChannel = getImage2ProviderChannel(request.providerChannelId);
  const providerChannelName =
    providerChannel?.displayName ??
    displayNameForProviderChannel(
      accountCandidates[0]?.baseUrl,
      accountCandidates[0]?.provider.name,
    );
  const legacyCandidates = await findAvailableProviders(request.modelId);

  if (accountCandidates.length === 0 && legacyCandidates.length === 0) {
    throw new ModelNotAvailableError(
      request.modelId,
      providerChannelName ?? null,
    );
  }

  // Short-circuit if this channel was recently tripped by a full rate-limit
  // sweep — avoids redundant DB lease attempts when the upstream is cooling off.
  if (await isChannelCircuitOpen(request.providerChannelId)) {
    throw new ProviderCapacityError(
      request.modelId,
      providerChannelName ?? null,
    );
  }

  const errors: unknown[] = [];
  const providerPoolErrors = new Map<string, unknown[]>();
  let accountAttempts = 0;
  const filteredAccountCandidates = request.providerChannelId
    ? accountCandidates.filter((account) =>
        providerChannelMatchesBaseUrl(
          request.providerChannelId,
          account.baseUrl,
          account.provider.id,
        ),
      )
    : accountCandidates;
  const maxAccountAttempts = maxAttemptsForAccounts(
    filteredAccountCandidates,
    request.providerChannelId,
  );

  for (const account of filteredAccountCandidates) {
    if (accountAttempts >= maxAccountAttempts) {
      break;
    }

    const target = options?.leaseContext
      ? await leaseProviderAccount(account, options.leaseContext)
      : null;

    if (!target) {
      continue;
    }

    accountAttempts += 1;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), generationTimeoutMs());

    try {
      const adapter = buildAdapter({
        id: target.account.id,
        name: target.account.name ?? target.provider.name,
        protocol: providerProtocolToModelProtocol(target.provider.protocol),
        baseUrl: target.account.baseUrl,
        apiKey: decrypt(target.account.apiKeyEnc),
      });

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
      const healthUpdates = await Promise.allSettled([
        markProviderHealthy(target.provider.id),
        markAccountHealthy(target.account.id),
        // A successful generation means the channel is healthy — clear any breaker.
        resetChannelCircuit(request.providerChannelId),
      ]);
      for (const update of healthUpdates) {
        if (update.status === "rejected") {
          logger.warn(
            {
              providerId: target.provider.id,
              providerAccountId: target.account.id,
              error: serializeProviderError(update.reason),
            },
            "Provider generated an image, but its health status could not be updated.",
          );
        }
      }

      return {
        result,
        providerId: target.provider.id,
        providerName: target.provider.name,
        providerAccountId: target.account.id,
        providerAccountName: target.account.name ?? null,
        multiplier: target.provider.costMultiplier,
      };
    } catch (error) {
      const rejectedError = providerRejectedError(error);

      if (rejectedError) {
        throw rejectedError;
      }

      const downgradable = isDowngradable(error);
      errors.push(error);

      if (shouldRecordProviderPoolError(error)) {
        const providerErrors = providerPoolErrors.get(target.provider.id) ?? [];
        providerErrors.push(error);
        providerPoolErrors.set(target.provider.id, providerErrors);
      }

      await markAccountErrored(target.account.id, error, downgradable);

      if (request.executionPolicy === "single-submit") {
        throw downgradable ? new ProviderSubmissionUnknownError(error) : error;
      }

      if (!downgradable && !isFatalAccountError(error)) {
        throw error;
      }
    } finally {
      clearTimeout(timer);
      try {
        await releaseAccountLease(target.leaseId, "provider_attempt_finished");
      } catch (error) {
        logger.warn(
          { leaseId: target.leaseId, error: serializeProviderError(error) },
          "Provider account lease release failed; worker reconciliation will retry.",
        );
      }
    }
  }

  await Promise.all(
    Array.from(providerPoolErrors.entries()).map(
      ([providerId, providerErrors]) =>
        markProviderPoolErrored(providerId, providerErrors),
    ),
  );

  // If every error in this round was a rate-limit or transient failure (no
  // fatal/content errors), trip the channel circuit so the next N seconds of
  // jobs skip the DB and get queued instead of hammering the upstream further.
  if (
    request.providerChannelId &&
    errors.length > 0 &&
    errors.every((e) => isRateLimited(e) || isDowngradable(e))
  ) {
    await tripChannelCircuit(request.providerChannelId);
  }

  let legacyAttempts = 0;
  for (const provider of request.providerChannelId ? [] : legacyCandidates) {
    const hasAccounts = await db.providerAccount.count({
      where: { providerId: provider.id },
    });

    if (hasAccounts > 0) {
      continue;
    }

    legacyAttempts += 1;

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
      try {
        await markProviderHealthy(provider.id);
      } catch (error) {
        logger.warn(
          { providerId: provider.id, error: serializeProviderError(error) },
          "Provider generated an image, but its health status could not be updated.",
        );
      }

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
      const rejectedError = providerRejectedError(error);

      if (rejectedError) {
        throw rejectedError;
      }

      const downgradable = isDowngradable(error);
      errors.push(error);
      await markProviderErrored(provider.id, error, downgradable);

      if (request.executionPolicy === "single-submit") {
        throw downgradable ? new ProviderSubmissionUnknownError(error) : error;
      }

      if (!downgradable) {
        throw error;
      }
    }
  }

  if (
    accountAttempts === 0 &&
    legacyAttempts === 0 &&
    filteredAccountCandidates.length > 0
  ) {
    throw new ProviderCapacityError(
      request.modelId,
      providerChannelName ?? null,
    );
  }

  throw new ProviderUnavailableError(
    request.modelId,
    providerChannelName ?? null,
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
    findEligibleProviderAccounts(modelId, providerChannelId),
    findAvailableProviders(modelId),
  ]);
  const providerChannel = getImage2ProviderChannel(providerChannelId);
  const legacyProviders = await Promise.all(
    (providerChannelId ? [] : providers).map(async (provider) => ({
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
      providerChannel?.displayName ??
        displayNameForProviderChannel(
          accounts[0]?.baseUrl,
          accounts[0]?.provider.name,
        ) ??
        null,
    );
  }
}
