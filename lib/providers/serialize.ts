import type { Provider, ProviderAccount } from "@prisma/client";

export function maskApiKeyFingerprint(value: string): string {
  if (!value) {
    return "";
  }

  if (value.length <= 12) {
    return value;
  }

  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function serializeProviderAccount(
  account: ProviderAccount,
  options?: {
    dailyUsed?: number;
    isDefault?: boolean;
  },
) {
  return {
    id: account.id,
    providerId: account.providerId,
    name: account.name,
    baseUrl: account.baseUrl,
    apiKeyFingerprintMasked: maskApiKeyFingerprint(account.apiKeyFingerprint),
    priority: account.priority,
    weight: account.weight,
    maxConcurrency: account.maxConcurrency,
    inFlight: account.inFlight,
    health: account.health,
    isActive: account.isActive,
    consecutiveErrors: account.consecutiveErrors,
    lastLeaseAt: account.lastLeaseAt,
    lastHealthyAt: account.lastHealthyAt,
    lastErrorAt: account.lastErrorAt,
    lastErrorMsg: account.lastErrorMsg,
    cooldownUntil: account.cooldownUntil,
    dailyLimit: account.dailyLimit,
    dailyUsed: options?.dailyUsed ?? account.dailyUsed,
    note: account.note,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    hasApiKey: Boolean(account.apiKeyEnc),
    isDefault: options?.isDefault ?? false,
  };
}

export function serializeProvider(
  provider: Provider & {
    accounts?: Array<{
      id: string;
      health: string;
      isActive: boolean;
      maxConcurrency: number;
      inFlight: number;
    }>;
  },
) {
  const accounts = provider.accounts ?? [];

  return {
    id: provider.id,
    name: provider.name,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    priority: provider.priority,
    modelsSupported: provider.modelsSupported,
    costMultiplier: provider.costMultiplier,
    isActive: provider.isActive,
    health: provider.health,
    consecutiveErrors: provider.consecutiveErrors,
    lastHealthyAt: provider.lastHealthyAt,
    lastErrorAt: provider.lastErrorAt,
    lastErrorMsg: provider.lastErrorMsg,
    note: provider.note,
    createdAt: provider.createdAt,
    accountCount: accounts.length,
    activeAccountCount: accounts.filter((account) => account.isActive).length,
    healthyAccountCount: accounts.filter(
      (account) => account.isActive && account.health !== "DOWN",
    ).length,
    totalMaxConcurrency: accounts.reduce(
      (sum, account) => sum + account.maxConcurrency,
      0,
    ),
    inFlight: accounts.reduce((sum, account) => sum + account.inFlight, 0),
    hasApiKey: Boolean(provider.apiKeyEnc),
    apiKey: provider.apiKeyEnc ? "***" : "",
  };
}
