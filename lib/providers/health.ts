import type { ProviderHealth } from "@prisma/client";

import { db } from "@/lib/db";
import { ProviderRequestError, serializeProviderError } from "@/lib/providers/diagnostics";
import {
  isFatalAccountError,
  isRateLimited,
} from "@/lib/providers/failure-policy";

/**
 * Compute how long to cool down an account after an error.
 *
 * Priority order:
 * 1. Retry-After header from the upstream response (exact window the API gave us)
 * 2. Exponential back-off scaled to consecutive error count
 *    - rate-limit base: 60 s → 2 min → 4 min → 8 min → cap 15 min
 *    - transient/other base: 30 s → 1 min → 2 min → 4 min → cap 10 min
 * 3. Fatal auth errors: 5 minutes (account will be marked DOWN anyway)
 */
function adaptiveCooldownMs(error: unknown, consecutiveErrors: number): number {
  if (error instanceof ProviderRequestError && error.diagnostic.retryAfterSeconds) {
    const ms = error.diagnostic.retryAfterSeconds * 1000;
    return Math.min(Math.max(ms, 5_000), 30 * 60_000);
  }

  if (isFatalAccountError(error)) {
    return 5 * 60_000;
  }

  const n = Math.max(0, consecutiveErrors - 1);
  if (isRateLimited(error)) {
    return Math.min(60_000 * Math.pow(2, n), 15 * 60_000);
  }

  return Math.min(30_000 * Math.pow(2, n), 10 * 60_000);
}

export async function markProviderHealthy(providerId: string): Promise<void> {
  await db.provider.update({
    where: { id: providerId },
    data: {
      consecutiveErrors: 0,
      health: "HEALTHY",
      lastHealthyAt: new Date(),
    },
  });
}

export async function markAccountHealthy(accountId: string): Promise<void> {
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

export async function markProviderErrored(
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

export async function markProviderPoolErrored(
  providerId: string,
  errors: unknown[],
): Promise<void> {
  if (errors.length === 0) {
    return;
  }

  await markProviderErrored(
    providerId,
    new Error(
      `账号池本轮尝试失败（${errors.length} 个账号）: ${errors
        .map(serializeProviderError)
        .join("; ")}`,
    ),
    true,
  );
}

export async function markAccountErrored(
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
        isRateLimited(error) || isFatalAccountError(error) || downgradable
          ? new Date(Date.now() + adaptiveCooldownMs(error, nextErrors))
          : undefined,
      lastErrorAt: new Date(),
      lastErrorMsg: serializeProviderError(error).slice(0, 500),
    },
  });
}
