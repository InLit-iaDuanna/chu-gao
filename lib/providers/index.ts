import { decrypt } from "@/lib/crypto";
import { ProviderSubmissionUnknownError } from "@/lib/providers/single-submit";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { withModelCall } from "@/lib/model-call-log";
import { getModel } from "@/lib/models/registry";
import { providerSupportsGif } from "@/lib/provider-channel-request-config";
import type { InternalRequest } from "@/lib/models/types";
import {
  displayNameForProviderChannel,
  getImage2ProviderChannel,
  supportsProviderChannels,
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
  isFallbackProvider,
  leaseProviderAccount,
  maxAttemptsForAccounts,
  providerCostMultiplier,
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
      baseUrl: string;
      costMultiplier: number;
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

  const providerChannelId = supportsProviderChannels(request.modelId)
    ? request.providerChannelId
    : undefined;
  const providerChannel = getImage2ProviderChannel(providerChannelId);

  // Check before the account query: a tripped pool may now have no eligible
  // accounts because they are cooling, but it still needs a capacity retry.
  if (await isChannelCircuitOpen(providerChannelId, request.modelId)) {
    throw new ProviderCapacityError(
      request.modelId,
      providerChannel?.displayName ?? null,
    );
  }

  // Healthy but saturated accounts must remain candidates: saturation is a
  // queueing condition, not an outage. The atomic lease below decides which
  // job can start immediately.
  let accountCandidates = await findEligibleProviderAccounts(
    request.modelId,
    providerChannelId,
  );
  let legacyCandidates = providerChannelId
    ? []
    : await findLegacyProviders(request.modelId);
  if (request.outputFormat === "gif") {
    const baseUrls = [
      ...new Set([
        ...accountCandidates.map((account) => account.baseUrl),
        ...legacyCandidates.map((provider) => provider.baseUrl),
      ]),
    ];
    const supportedUrls = new Set<string>();
    for (const baseUrl of baseUrls) {
      if (await providerSupportsGif(baseUrl)) supportedUrls.add(baseUrl);
    }
    accountCandidates = accountCandidates.filter((account) =>
      supportedUrls.has(account.baseUrl),
    );
    legacyCandidates = legacyCandidates.filter((provider) =>
      supportedUrls.has(provider.baseUrl),
    );
  }
  const providerChannelName =
    providerChannel?.displayName ??
    displayNameForProviderChannel(
      accountCandidates[0]?.baseUrl,
      accountCandidates[0]?.provider.name,
    );

  if (accountCandidates.length === 0 && legacyCandidates.length === 0) {
    throw new ModelNotAvailableError(
      request.modelId,
      providerChannelName ?? null,
    );
  }

  const errors: unknown[] = [];
  const providerPoolErrors = new Map<string, unknown[]>();
  let accountAttempts = 0;
  let capacityBlocked = false;
  const attemptedAccountIds = new Set<string>();
  const phases = [false, true].map((fallback) => {
    const accounts = accountCandidates.filter(
      (account) => isFallbackProvider(account.provider) === fallback,
    );
    return {
      fallback,
      accounts,
      providers: legacyCandidates.filter(
        (provider) => isFallbackProvider(provider) === fallback,
      ),
      maxAttempts: maxAttemptsForAccounts(accounts),
    };
  });
  const maxAccountAttempts = phases.reduce(
    (total, phase) => total + phase.maxAttempts,
    0,
  );

  // Explicit channel selection stays within that channel. Automatic selection
  // exhausts its normal attempt budget (including legacy providers) first.
  for (const phase of phases) {
    if (
      phase.fallback &&
      (capacityBlocked ||
        accountCandidates.some(
          (account) =>
            !isFallbackProvider(account.provider) &&
            !attemptedAccountIds.has(account.id) &&
            account.inFlight >= account.maxConcurrency,
        ))
    ) {
      throw new ProviderCapacityError(
        request.modelId,
        providerChannelName ?? null,
      );
    }
    let phaseAttempts = 0;
    for (const account of phase.accounts) {
      if (phaseAttempts >= phase.maxAttempts) {
        break;
      }

      const target = options?.leaseContext
        ? await leaseProviderAccount(account, options.leaseContext)
        : null;

      if (!target) {
        capacityBlocked = true;
        continue;
      }

      accountAttempts += 1;
      phaseAttempts += 1;
      attemptedAccountIds.add(account.id);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), generationTimeoutMs());
      let dispatched = false;

      try {
        const apiKey = decrypt(target.account.apiKeyEnc);
        const adapter = buildAdapter({
          id: target.account.id,
          name: target.account.name ?? target.provider.name,
          protocol: providerProtocolToModelProtocol(target.provider.protocol),
          baseUrl: target.account.baseUrl,
          apiKey,
        });

        if (phase.fallback && !options?.onProviderSelected) {
          throw new Error(
            "Fallback provider requires a pre-dispatch credit reservation",
          );
        }
        await options?.onProviderSelected?.({
          providerId: target.provider.id,
          providerName: target.provider.name,
          providerAccountId: target.account?.id ?? null,
          providerAccountName: target.account?.name ?? null,
          baseUrl: target.account.baseUrl,
          costMultiplier: providerCostMultiplier(target.provider),
        });
        dispatched = true;
        const result = await withModelCall(
          {
            kind: "image",
            secrets: [apiKey],
            operation: "image.generate",
            modelId: request.modelId,
            requestContent: request,
            userId: options?.leaseContext?.userId,
            generationId: options?.leaseContext?.generationId,
            providerId: target.provider.id,
            providerAccountId: target.account.id,
            providerName: `${target.provider.name} / ${target.account.name ?? target.account.id}`,
            endpoint: target.account.baseUrl,
          },
          () =>
            adapter.generate(request, controller.signal, options?.onProgress),
        );
        const healthUpdates = await Promise.allSettled([
          markProviderHealthy(target.provider.id),
          markAccountHealthy(target.account.id),
          // A successful generation means the channel is healthy — clear any breaker.
          resetChannelCircuit(providerChannelId, request.modelId),
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
          multiplier: providerCostMultiplier(target.provider),
        };
      } catch (error) {
        // Local reservation/ownership failures have not submitted anything and
        // must not penalize a provider or turn into an ambiguous submission.
        if (!dispatched) throw error;
        const rejectedError = providerRejectedError(error);

        if (rejectedError) {
          throw rejectedError;
        }

        const downgradable = isDowngradable(error);
        errors.push(error);

        if (shouldRecordProviderPoolError(error)) {
          const providerErrors =
            providerPoolErrors.get(target.provider.id) ?? [];
          providerErrors.push(error);
          providerPoolErrors.set(target.provider.id, providerErrors);
        }

        await markAccountErrored(target.account.id, error, downgradable);

        if (request.executionPolicy === "single-submit") {
          throw downgradable
            ? new ProviderSubmissionUnknownError(error)
            : error;
        }

        if (!downgradable && !isFatalAccountError(error)) {
          throw error;
        }
      } finally {
        clearTimeout(timer);
        try {
          await releaseAccountLease(
            target.leaseId,
            "provider_attempt_finished",
          );
        } catch (error) {
          logger.warn(
            { leaseId: target.leaseId, error: serializeProviderError(error) },
            "Provider account lease release failed; worker reconciliation will retry.",
          );
        }
      }
    }

    // A selected base URL can cover only part of a provider's accounts. Even
    // automatic selection must exhaust the eligible pool before penalizing it.
    if (!providerChannelId) {
      await Promise.all(
        Array.from(providerPoolErrors.entries())
          .filter(
            ([providerId, providerErrors]) =>
              providerErrors.length ===
              phase.accounts.filter(
                (account) => account.providerId === providerId,
              ).length,
          )
          .map(([providerId, providerErrors]) =>
            markProviderPoolErrored(providerId, providerErrors),
          ),
      );
    }

    // A partial sweep cannot establish a channel outage: untried or busy
    // accounts may still succeed. Only cool a fully attempted eligible pool.
    if (
      providerChannelId &&
      phase.accounts.length > 0 &&
      phaseAttempts === phase.accounts.length &&
      errors.length > 0 &&
      errors.every(isDowngradable)
    ) {
      await tripChannelCircuit(providerChannelId, undefined, request.modelId);
    }

    for (const provider of phase.providers) {
      const apiKey = decrypt(provider.apiKeyEnc);
      const adapter = buildAdapter({
        id: provider.id,
        name: provider.name,
        protocol: providerProtocolToModelProtocol(provider.protocol),
        baseUrl: provider.baseUrl,
        apiKey,
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), generationTimeoutMs());
      let dispatched = false;

      try {
        if (phase.fallback && !options?.onProviderSelected) {
          throw new Error(
            "Fallback provider requires a pre-dispatch credit reservation",
          );
        }
        await options?.onProviderSelected?.({
          providerId: provider.id,
          providerName: provider.name,
          providerAccountId: null,
          providerAccountName: null,
          baseUrl: provider.baseUrl,
          costMultiplier: providerCostMultiplier(provider),
        });
        dispatched = true;
        const result = await withModelCall(
          {
            kind: "image",
            secrets: [apiKey],
            operation: "image.generate",
            modelId: request.modelId,
            requestContent: request,
            userId: options?.leaseContext?.userId,
            generationId: options?.leaseContext?.generationId,
            providerId: provider.id,
            providerName: provider.name,
            endpoint: provider.baseUrl,
          },
          () =>
            adapter.generate(request, controller.signal, options?.onProgress),
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
          multiplier: providerCostMultiplier(provider),
        };
      } catch (error) {
        clearTimeout(timer);
        if (!dispatched) throw error;
        const rejectedError = providerRejectedError(error);

        if (rejectedError) {
          throw rejectedError;
        }

        const downgradable = isDowngradable(error);
        errors.push(error);
        await markProviderErrored(provider.id, error, downgradable);

        if (request.executionPolicy === "single-submit") {
          throw downgradable
            ? new ProviderSubmissionUnknownError(error)
            : error;
        }

        if (!downgradable) {
          throw error;
        }
      }
    }
  }

  if (capacityBlocked) {
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

async function findLegacyProviders(modelId: string) {
  const providers = await findAvailableProviders(modelId);
  const accountCounts = await Promise.all(
    providers.map((provider) =>
      db.providerAccount.count({ where: { providerId: provider.id } }),
    ),
  );

  // A configured pool must use its account leases, even when every account
  // is disabled or cooling. Its provider credentials cannot bypass that state.
  return providers.filter((_, index) => accountCounts[index] === 0);
}

export async function assertProviderAvailable(
  modelId: string,
  providerChannelId?: string,
): Promise<void> {
  const channelId = supportsProviderChannels(modelId)
    ? providerChannelId
    : undefined;
  const [accounts, legacyProviders] = await Promise.all([
    findEligibleProviderAccounts(modelId, channelId),
    channelId ? [] : findLegacyProviders(modelId),
  ]);
  const providerChannel = getImage2ProviderChannel(channelId);

  if (accounts.length === 0 && legacyProviders.length === 0) {
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
