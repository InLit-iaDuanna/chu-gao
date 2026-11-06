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

export type ProviderAccountWithProvider = ProviderAccount & {
  provider: Provider;
};

export interface ProviderAccountLeaseTarget {
  provider: Provider;
  account: ProviderAccount;
}

function accountReliabilityScore(account: ProviderAccountWithProvider): number {
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

export async function releaseAccountLease(accountId: string): Promise<void> {
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

export async function leaseProviderAccount(
  account: ProviderAccountWithProvider,
): Promise<ProviderAccountLeaseTarget | null> {
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

export function maxAttemptsForAccounts(
  accounts: ProviderAccountWithProvider[],
  providerChannelId?: string | null,
): number {
  if (!providerChannelId) {
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
