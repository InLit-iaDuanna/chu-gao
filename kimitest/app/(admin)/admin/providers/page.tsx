import { headers } from "next/headers";

import {
  ProviderConsole,
  type ConsoleChannel,
} from "@/components/admin/ProviderConsole";
import { requireAdminSessionFromHeaders } from "@/lib/auth";
import { db } from "@/lib/db";
import { listModels } from "@/lib/models/registry";
import { getProviderChannelDisplayNameMap } from "@/lib/provider-channel-config";
import {
  DEFAULT_CHANNEL_REQUEST_CONFIG,
  getChannelRequestConfigMap,
  type ChannelRequestConfig,
} from "@/lib/provider-channel-request-config";
import {
  displayNameForProviderChannelWithMap,
  normalizeProviderChannelBaseUrl,
  type ProviderChannelDisplayNameMap,
} from "@/lib/provider-channels";
import { serializeProviderAccount } from "@/lib/providers/serialize";

type SerializedAccount = ReturnType<typeof serializeProviderAccount>;
type ProviderData = NonNullable<Awaited<ReturnType<typeof getProviders>>>;

function deriveChannelHealth(
  healthyAccountCount: number,
  accountCount: number,
): ConsoleChannel["health"] {
  if (accountCount === 0 || healthyAccountCount === 0) {
    return "DOWN";
  }

  return healthyAccountCount < accountCount ? "DEGRADED" : "HEALTHY";
}

function channelGroupsForProvider(
  provider: {
    name: string;
    protocol: string;
    modelsSupported: string[];
    accounts: SerializedAccount[];
  },
  displayNameMap: ProviderChannelDisplayNameMap,
) {
  const groups = new Map<
    string,
    {
      baseUrl: string;
      displayName: string;
      providerName: string;
      protocol: string;
      modelsSupported: string[];
      accounts: SerializedAccount[];
    }
  >();

  for (const account of provider.accounts) {
    if (!account.isActive) {
      continue;
    }

    const current = groups.get(account.baseUrl) ?? {
      baseUrl: account.baseUrl,
      displayName:
        displayNameForProviderChannelWithMap(
          account.baseUrl,
          provider.name,
          displayNameMap,
        ) ?? provider.name,
      providerName: provider.name,
      protocol: provider.protocol,
      modelsSupported: provider.modelsSupported,
      accounts: [],
    };

    current.accounts.push(account);
    groups.set(account.baseUrl, current);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      accountCount: group.accounts.length,
      activeAccountCount: group.accounts.filter((account) => account.isActive)
        .length,
      healthyAccountCount: group.accounts.filter(
        (account) => account.isActive && account.health !== "DOWN",
      ).length,
      inFlight: group.accounts.reduce(
        (sum, account) => sum + account.inFlight,
        0,
      ),
      maxConcurrency: group.accounts.reduce(
        (sum, account) => sum + account.maxConcurrency,
        0,
      ),
      dailyUsed: group.accounts.reduce(
        (sum, account) => sum + account.dailyUsed,
        0,
      ),
      dailyLimit: group.accounts.some((account) => account.dailyLimit === null)
        ? null
        : group.accounts.reduce(
            (sum, account) => sum + (account.dailyLimit ?? 0),
            0,
          ),
    }))
    .sort((left, right) => {
      if (right.healthyAccountCount !== left.healthyAccountCount) {
        return right.healthyAccountCount - left.healthyAccountCount;
      }

      return left.displayName.localeCompare(right.displayName, "zh-CN");
    });
}

function buildChannels(providerData: ProviderData): ConsoleChannel[] {
  const channels: ConsoleChannel[] = [];

  for (const provider of providerData.providers) {
    if (!provider.isActive) {
      continue;
    }

    const groups = channelGroupsForProvider(
      provider,
      providerData.displayNameMap,
    );

    for (const group of groups) {
      const requestConfig: ChannelRequestConfig =
        providerData.requestConfigMap[
          normalizeProviderChannelBaseUrl(group.baseUrl) ?? ""
        ] ?? DEFAULT_CHANNEL_REQUEST_CONFIG;

      channels.push({
        providerId: provider.id,
        providerName: group.providerName,
        protocol: group.protocol,
        modelsSupported: group.modelsSupported,
        baseUrl: group.baseUrl,
        displayName: group.displayName,
        health: deriveChannelHealth(
          group.healthyAccountCount,
          group.accountCount,
        ),
        accountCount: group.accountCount,
        activeAccountCount: group.activeAccountCount,
        healthyAccountCount: group.healthyAccountCount,
        inFlight: group.inFlight,
        maxConcurrency: group.maxConcurrency,
        dailyUsed: group.dailyUsed,
        dailyLimit: group.dailyLimit,
        accounts: group.accounts.map((account) => ({
          id: account.id,
          name: account.name,
          baseUrl: account.baseUrl,
          apiKeyFingerprintMasked: account.apiKeyFingerprintMasked,
          priority: account.priority,
          weight: account.weight,
          maxConcurrency: account.maxConcurrency,
          inFlight: account.inFlight,
          health: account.health,
          isActive: account.isActive,
          consecutiveErrors: account.consecutiveErrors,
          cooldownUntil: account.cooldownUntil?.toISOString() ?? null,
          dailyLimit: account.dailyLimit,
          dailyUsed: account.dailyUsed,
          note: account.note,
          lastErrorMsg: account.lastErrorMsg,
          hasApiKey: account.hasApiKey,
          isDefault: account.isDefault,
        })),
        requestConfig,
      });
    }
  }

  return channels;
}

async function getProviders() {
  const admin = await requireAdminSessionFromHeaders(await headers());

  if (!admin || !process.env.DATABASE_URL) {
    return null;
  }

  try {
    const [providers, displayNameMap, requestConfigMap] = await Promise.all([
      db.provider.findMany({
        where: { isActive: true },
        orderBy: [
          { protocol: "asc" },
          { priority: "desc" },
          { createdAt: "desc" },
        ],
        include: { accounts: true },
      }),
      getProviderChannelDisplayNameMap(),
      getChannelRequestConfigMap(),
    ]);
    const accountIds = providers.flatMap((provider) =>
      provider.accounts.map((account) => account.id),
    );
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dailyUsage = accountIds.length
      ? await db.generation.groupBy({
          by: ["providerAccountId"],
          where: {
            providerAccountId: {
              in: accountIds,
            },
            createdAt: { gte: today },
            deletedAt: null,
            status: { not: "CANCELED" },
          },
          _count: {
            _all: true,
          },
        })
      : [];
    const usageMap = new Map(
      dailyUsage.map((item) => [item.providerAccountId, item._count._all]),
    );

    return {
      displayNameMap,
      requestConfigMap,
      providers: providers.map((provider) => ({
        ...provider,
        accounts: provider.accounts.map((account) =>
          serializeProviderAccount(account, {
            dailyUsed: usageMap.get(account.id) ?? 0,
            isDefault: account.name === `${provider.name} 默认账号`,
          }),
        ),
      })),
    };
  } catch {
    return null;
  }
}

export default async function AdminProvidersPage() {
  const providerData = await getProviders();
  const models = listModels();
  const channels = providerData ? buildChannels(providerData) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">渠道</p>
          <h1 className="mt-2 text-3xl font-semibold">模型渠道管理</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-text-muted">
            大渠道按 Base URL 自动分组；左侧选渠道，右侧管理账号、请求格式与设置。
          </p>
        </div>
      </div>

      {providerData ? (
        <ProviderConsole channels={channels} models={models} />
      ) : (
        <div className="surface-panel p-6 text-sm leading-6 text-text-muted">
          渠道服务暂不可用，请确认数据库连接后刷新。
        </div>
      )}
    </div>
  );
}
