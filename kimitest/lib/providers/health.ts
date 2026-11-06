import type { ProviderHealth } from "@prisma/client";

import { db } from "@/lib/db";
import { serializeProviderError } from "@/lib/providers/diagnostics";
import {
  isFatalAccountError,
  isRateLimited,
} from "@/lib/providers/failure-policy";

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
