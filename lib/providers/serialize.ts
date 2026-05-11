import type { Provider } from "@prisma/client";

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
