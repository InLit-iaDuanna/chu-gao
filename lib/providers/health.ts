import type { ProviderHealth } from "@prisma/client";

import { db } from "@/lib/db";
import { ProviderRequestError, serializeProviderError } from "@/lib/providers/diagnostics";
import {
  isFatalAccountError,
  isRateLimited,
} from "@/lib/providers/failure-policy";

/**
 * Compute how long to cool down an account after it starts cooling.
 *
 * Priority order:
 * 1. Retry-After header from the upstream response (exact window the API gave us)
 * 2. Fixed 5 minutes for all other cases — gives the account meaningful
 *    recovery time without the exponential blowup of the old backoff scheme.
 *    (Cooldown only triggers on the 3rd+ consecutive failure, so by the time
 *    we get here the account genuinely needs a break.)
 */
function adaptiveCooldownMs(error: unknown, _consecutiveErrors: number): number {
  if (error instanceof ProviderRequestError && error.diagnostic.retryAfterSeconds) {
    const ms = error.diagnostic.retryAfterSeconds * 1000;
    return Math.min(Math.max(ms, 5_000), 30 * 60_000);
  }

  // Fixed 5-minute cooldown for all other error types.
  return 5 * 60_000;
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

  // For high-concurrency account pools transient failures should be absorbed
  // before triggering a cooldown.  We wait until the 3rd consecutive failure
  // before cooling the account so a couple of stray 429s in a busy pool do not
  // shrink the active set unnecessarily.
  //
  // Auth errors (fatal) always cool immediately regardless.
  // When cooling does start, use a fixed 5-minute window so the account gets
  // meaningful recovery time without endless short retries.
  const shouldCoolRateLimit = isRateLimited(error) && nextErrors >= 3;
  const shouldCoolTransient = !isRateLimited(error) && downgradable && nextErrors >= 3;
  const shouldCoolFatal = isFatalAccountError(error);
  const shouldCool = shouldCoolRateLimit || shouldCoolTransient || shouldCoolFatal;

  await db.providerAccount.update({
    where: { id: accountId },
    data: {
      consecutiveErrors: nextErrors,
      // Increment the per-category counter so account scoring and the
      // circuit breaker can distinguish rate-limits from hard failures.
      ...(isRateLimited(error) ? { rateLimitErrors: { increment: 1 } } : {}),
      ...(!isRateLimited(error) && downgradable ? { transientErrors: { increment: 1 } } : {}),
      health,
      cooldownUntil: shouldCool
        ? new Date(Date.now() + adaptiveCooldownMs(error, nextErrors))
        : undefined,
      lastErrorAt: new Date(),
      lastErrorMsg: serializeProviderError(error).slice(0, 500),
    },
  });
}
