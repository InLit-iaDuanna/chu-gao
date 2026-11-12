import type { Provider, ProviderAccount } from "@prisma/client";

import { db } from "@/lib/db";
import { getModel } from "@/lib/models/registry";
import { supportsProviderChannels } from "@/lib/provider-channels";
import {
  providerChannelMatchesBaseUrl,
  supportedModelIds,
} from "@/lib/providers/availability";
import { providerAccountMaxAttempts } from "@/lib/providers/config";
import { modelProtocolToProviderProtocol } from "@/lib/providers/protocols";

// This pool is deliberately separate from ordinary providers sharing its URL.
export const FALLBACK_PROVIDER_ID = "ldai-fallback";

export function isFallbackProvider(provider: { id: string }): boolean {
  return provider.id === FALLBACK_PROVIDER_ID;
}

export function providerCostMultiplier(provider: {
  id: string;
  costMultiplier: number;
}): number {
  return Number.isFinite(provider.costMultiplier) && provider.costMultiplier > 0
    ? provider.costMultiplier
    : isFallbackProvider(provider)
      ? 2
      : 1;
}

export type ProviderAccountWithProvider = ProviderAccount & {
  provider: Provider;
};

export interface ProviderAccountLeaseTarget {
  provider: Provider;
  account: ProviderAccount;
  leaseId: string;
}

export interface ProviderLeaseContext {
  generationId: string;
  userId: string;
  executionToken: string;
}

function accountReliabilityScore(account: ProviderAccountWithProvider): number {
  let score = 0;

  if (account.lastHealthyAt) {
    score += 10_000;
  }

  // Hard-penalty: account is in cooldown — push it after all healthy candidates.
  // The lease step will skip it anyway, but sorting it last avoids wasted
  // lease attempts earlier in the list.
  if (account.cooldownUntil && account.cooldownUntil > new Date()) {
    score -= 100_000;
  }

  // Specific error signals (kept for backwards-compat with existing lastErrorMsg values)
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

function compareProviderAccounts(
  left: ProviderAccountWithProvider,
  right: ProviderAccountWithProvider,
): number {
  const fallbackOrder =
    Number(isFallbackProvider(left.provider)) -
    Number(isFallbackProvider(right.provider));
  if (fallbackOrder !== 0) {
    return fallbackOrder;
  }

  if (right.provider.priority !== left.provider.priority) {
    return right.provider.priority - left.provider.priority;
  }

  if (right.priority !== left.priority) {
    return right.priority - left.priority;
  }

  // Keep equally prioritized pools grouped so each pool's strategy defines
  // a consistent order, even when neighboring pools use different strategies.
  if (left.provider.id !== right.provider.id) {
    return left.provider.id.localeCompare(right.provider.id);
  }

  const leaseDifference =
    (left.lastLeaseAt?.getTime() ?? 0) - (right.lastLeaseAt?.getTime() ?? 0);
  if (left.provider.selectionStrategy === "ROUND_ROBIN") {
    if (leaseDifference !== 0) {
      return leaseDifference;
    }
  } else if (left.inFlight !== right.inFlight) {
    return left.inFlight - right.inFlight;
  }

  const reliabilityDifference =
    accountReliabilityScore(right) - accountReliabilityScore(left);
  if (reliabilityDifference !== 0) {
    return reliabilityDifference;
  }

  const leftFreeSlots = left.maxConcurrency - left.inFlight;
  const rightFreeSlots = right.maxConcurrency - right.inFlight;
  if (rightFreeSlots !== leftFreeSlots) {
    return rightFreeSlots - leftFreeSlots;
  }

  if (right.weight !== left.weight) {
    return right.weight - left.weight;
  }

  return (
    leaseDifference ||
    left.createdAt.getTime() - right.createdAt.getTime() ||
    left.id.localeCompare(right.id)
  );
}

export async function releaseAccountLease(
  leaseId: string,
  releaseReason = "completed",
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const lease = await tx.providerAccountLease.findUnique({
      where: { id: leaseId },
      select: {
        providerAccountId: true,
        releasedAt: true,
      },
    });
    if (!lease || lease.releasedAt) {
      return false;
    }

    // Serialize releases with new acquisitions and reconcile the counter from
    // the lease rows. This remains correct even if an older admin action left
    // the legacy inFlight counter out of sync.
    const accountRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "ProviderAccount"
      WHERE "id" = ${lease.providerAccountId}
      FOR UPDATE
    `;
    if (accountRows.length === 0) {
      return false;
    }

    // Marking the lease first makes duplicate worker/recovery releases
    // idempotent: only the transaction that changes releasedAt owns the slot.
    const released = await tx.providerAccountLease.updateMany({
      where: {
        id: leaseId,
        releasedAt: null,
      },
      data: {
        releasedAt: new Date(),
        releaseReason,
      },
    });

    if (released.count === 0) {
      return false;
    }

    const activeLeaseCount = await tx.providerAccountLease.count({
      where: {
        providerAccountId: lease.providerAccountId,
        releasedAt: null,
      },
    });
    await tx.providerAccount.update({
      where: { id: lease.providerAccountId },
      data: { inFlight: activeLeaseCount },
    });

    return true;
  });
}

export async function reconcileProviderAccountInFlight(
  accountId: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const accountRows = await tx.$queryRaw<
      Array<{ id: string; inFlight: number }>
    >`
      SELECT "id", "inFlight"
      FROM "ProviderAccount"
      WHERE "id" = ${accountId}
      FOR UPDATE
    `;
    const account = accountRows[0];
    if (!account) {
      return false;
    }

    const activeLeaseCount = await tx.providerAccountLease.count({
      where: {
        providerAccountId: accountId,
        releasedAt: null,
      },
    });

    if (account.inFlight === activeLeaseCount) {
      return false;
    }

    await tx.providerAccount.update({
      where: { id: accountId },
      data: { inFlight: activeLeaseCount },
    });
    return true;
  });
}

export async function reconcileProviderAccountCounters(
  limit = 500,
): Promise<number> {
  const batchSize = Number.isInteger(limit) && limit > 0 ? limit : 500;
  let correctedCount = 0;
  let cursor: string | undefined;

  do {
    const accounts = await db.providerAccount.findMany({
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
      orderBy: { id: "asc" },
    });

    for (const account of accounts) {
      if (await reconcileProviderAccountInFlight(account.id)) {
        correctedCount += 1;
      }
    }

    cursor = accounts.at(-1)?.id;
    if (accounts.length < batchSize) {
      break;
    }
  } while (cursor);

  return correctedCount;
}

export async function leaseProviderAccount(
  account: ProviderAccountWithProvider,
  context: ProviderLeaseContext,
): Promise<ProviderAccountLeaseTarget | null> {
  return db.$transaction(async (tx) => {
    const leased = await tx.providerAccount.updateMany({
      where: {
        id: account.id,
        isActive: true,
        health: { not: "DOWN" },
        provider: { isActive: true, health: { not: "DOWN" } },
        // Use the current database value rather than the candidate snapshot;
        // an admin concurrency change must take effect immediately.
        inFlight: { lt: db.providerAccount.fields.maxConcurrency },
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

    // Attach the lease to the execution in the same transaction as the
    // counter increment. A process crash cannot leave an untraceable slot.
    const attached = await tx.generation.updateMany({
      where: {
        id: context.generationId,
        userId: context.userId,
        status: "RUNNING",
        executionToken: context.executionToken,
        deletedAt: null,
      },
      data: {
        providerId: account.providerId,
        providerAccountId: account.id,
        heartbeatAt: new Date(),
      },
    });

    if (attached.count === 0) {
      // Keep the transaction balanced if the generation was canceled or
      // superseded between worker claim and provider selection.
      await tx.providerAccount.updateMany({
        where: { id: account.id, inFlight: { gt: 0 } },
        data: { inFlight: { decrement: 1 } },
      });
      return null;
    }

    const lease = await tx.providerAccountLease.create({
      data: {
        providerAccountId: account.id,
        generationId: context.generationId,
        executionToken: context.executionToken,
      },
    });

    return {
      provider: account.provider,
      account,
      leaseId: lease.id,
    };
  });
}

/** Release leases left behind by a worker that completed after its DB write. */
export async function releaseOrphanedProviderLeases(
  limit = 100,
): Promise<number> {
  const orphaned = await db.providerAccountLease.findMany({
    where: {
      releasedAt: null,
      generation: { status: { not: "RUNNING" } },
    },
    take: limit,
    select: {
      id: true,
    },
  });

  let releasedCount = 0;
  for (const lease of orphaned) {
    const released = await releaseAccountLease(lease.id, "orphaned");
    if (released) {
      releasedCount += 1;
    }
  }

  return releasedCount;
}

export async function findAvailableProviderAccounts(
  modelId: string,
  providerChannelId?: string,
): Promise<ProviderAccountWithProvider[]> {
  const model = getModel(modelId);

  if (!model || !process.env.DATABASE_URL) {
    return [];
  }

  const now = new Date();
  const modelIds = supportedModelIds(modelId);
  const channelId = supportsProviderChannels(modelId)
    ? providerChannelId
    : undefined;

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
    .filter((account) =>
      providerChannelMatchesBaseUrl(
        channelId,
        account.baseUrl,
        account.provider.id,
      ),
    )
    .sort(compareProviderAccounts);
}

/**
 * Return healthy configured accounts even when all of their slots are busy.
 * API preflight uses this list so temporary saturation remains queueable.
 */
export async function findEligibleProviderAccounts(
  modelId: string,
  providerChannelId?: string,
): Promise<ProviderAccountWithProvider[]> {
  const model = getModel(modelId);

  if (!model || !process.env.DATABASE_URL) {
    return [];
  }

  const now = new Date();
  const modelIds = supportedModelIds(modelId);
  const channelId = supportsProviderChannels(modelId)
    ? providerChannelId
    : undefined;

  const accounts = await db.providerAccount.findMany({
    where: {
      isActive: true,
      health: { not: "DOWN" },
      OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }],
      provider: {
        isActive: true,
        protocol: modelProtocolToProviderProtocol(model.protocol),
        OR: modelIds.map((id) => ({ modelsSupported: { has: id } })),
        health: { not: "DOWN" },
      },
    },
    include: { provider: true },
    orderBy: [
      { provider: { priority: "desc" } },
      { priority: "desc" },
      { inFlight: "asc" },
      { lastLeaseAt: "asc" },
      { createdAt: "asc" },
    ],
  });

  return accounts
    .filter((account) =>
      providerChannelMatchesBaseUrl(
        channelId,
        account.baseUrl,
        account.provider.id,
      ),
    )
    .sort(compareProviderAccounts);
}

export function maxAttemptsForAccounts(
  accounts: ProviderAccountWithProvider[],
): number {
  return Math.min(providerAccountMaxAttempts(), accounts.length);
}
