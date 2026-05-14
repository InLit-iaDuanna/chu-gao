import { headers } from "next/headers";

import {
  ProviderAccountCreateForm,
  ProviderAccountEditForm,
  ProviderAccountImportForm,
  ProviderChannelGroupPanel,
  ProviderCreateForm,
  ProviderPoolActions,
} from "@/components/admin/AdminForms";
import { DataTable } from "@/components/admin/DataTable";
import { requireAdminSessionFromHeaders } from "@/lib/auth";
import { db } from "@/lib/db";
import { listModels } from "@/lib/models/registry";
import { getProviderChannelDisplayNameMap } from "@/lib/provider-channel-config";
import {
  displayNameForProviderChannelWithMap,
  type ProviderChannelDisplayNameMap,
} from "@/lib/provider-channels";
import { serializeProviderAccount } from "@/lib/providers/serialize";

type SerializedAccount = ReturnType<typeof serializeProviderAccount>;
type ProviderData = NonNullable<Awaited<ReturnType<typeof getProviders>>>;
type ProviderWithAccounts = ProviderData["providers"][number];

const PROTOCOL_LABELS: Record<string, string> = {
  OPENAI_IMAGES: "Image2 / OpenAI Images",
  GEMINI_IMAGE: "Nano Banana / Gemini Image",
  OPENAI_RESPONSES_IMAGE: "Responses Image",
};

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

function groupProvidersByProtocol(providers: ProviderWithAccounts[]) {
  const groups = new Map<string, ProviderWithAccounts[]>();

  for (const provider of providers) {
    groups.set(provider.protocol, [
      ...(groups.get(provider.protocol) ?? []),
      provider,
    ]);
  }

  return Array.from(groups.entries()).sort(([left], [right]) =>
    left.localeCompare(right),
  );
}

async function getProviders() {
  const admin = await requireAdminSessionFromHeaders(await headers());

  if (!admin || !process.env.DATABASE_URL) {
    return null;
  }

  try {
    const [providers, displayNameMap] = await Promise.all([
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

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">渠道</p>
        <h1 className="mt-2 text-3xl font-semibold">模型渠道管理</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-text-muted">
          大渠道按 Base URL 自动分组；前台显示名在这里改，真实账号名、URL
          和错误信息保留在后台排障区。
        </p>
      </div>
      {providerData ? (
        <>
          <ProviderCreateForm models={models} />
          <DataTable
            headers={[
              "号池",
              "协议",
              "优先级",
              "健康度",
              "账号",
              "并发",
              "倍率",
              "模型",
            ]}
            rows={providerData.providers.map((provider) => [
              provider.name,
              provider.protocol,
              provider.priority,
              provider.health,
              `${provider.accounts.filter((account) => account.isActive).length}/${provider.accounts.length}`,
              `${provider.accounts.reduce((sum, account) => sum + account.inFlight, 0)}/${provider.accounts.reduce((sum, account) => sum + account.maxConcurrency, 0)}`,
              provider.costMultiplier,
              provider.modelsSupported.join(", "),
            ])}
          />
          <div className="grid gap-5">
            {groupProvidersByProtocol(providerData.providers).map(
              ([protocol, providers]) => {
                const protocolChannels = providers.flatMap((provider) =>
                  channelGroupsForProvider(
                    provider,
                    providerData.displayNameMap,
                  ).map((group) => ({
                    providerId: provider.id,
                    group,
                  })),
                );
                const modelNames = Array.from(
                  new Set(
                    providers.flatMap((provider) => provider.modelsSupported),
                  ),
                );
                const protocolAccountCount = providers.reduce(
                  (sum, provider) => sum + provider.accounts.length,
                  0,
                );
                const protocolHealthyCount = providers.reduce(
                  (sum, provider) =>
                    sum +
                    provider.accounts.filter(
                      (account) =>
                        account.isActive && account.health !== "DOWN",
                    ).length,
                  0,
                );

                return (
                  <section key={protocol} className="space-y-3">
                    <div className="surface-panel p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">
                            {PROTOCOL_LABELS[protocol] ?? protocol}
                          </p>
                          <p className="mt-1 text-xs text-text-muted">
                            {providers.length} 个号池 ·{" "}
                            {protocolChannels.length} 个大渠道
                          </p>
                          <p className="mt-1 text-xs text-text-muted">
                            {modelNames.join(", ") || "未标模型"}
                          </p>
                        </div>
                        <div className="rounded-full bg-surface-2 px-3 py-1 text-xs text-text-muted">
                          {protocolHealthyCount}/{protocolAccountCount} 账号可用
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 xl:grid-cols-2">
                      {protocolChannels.map(({ providerId, group }) => (
                        <ProviderChannelGroupPanel
                          key={`${providerId}:${group.baseUrl}`}
                          providerId={providerId}
                          group={group}
                        />
                      ))}
                      {protocolChannels.length === 0 ? (
                        <div className="surface-panel-soft p-4 text-sm text-text-muted">
                          这个协议还没有可用大渠道。先创建号池或导入 API。
                        </div>
                      ) : null}
                    </div>

                    <div className="grid gap-4">
                      {providers
                        .filter((provider) => provider.isActive)
                        .map((provider) => (
                          <details
                            key={provider.id}
                            className="surface-panel p-4"
                          >
                            <summary className="cursor-pointer list-none">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium">
                                    {provider.name} 号池
                                  </p>
                                  <p className="mt-1 break-all text-xs text-text-muted">
                                    默认 URL: {provider.baseUrl}
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                  <div className="rounded-full bg-surface-2 px-3 py-1 text-xs text-text-muted">
                                    {provider.modelsSupported.join(", ")}
                                  </div>
                                  <ProviderPoolActions
                                    providerId={provider.id}
                                    providerName={provider.name}
                                    accountCount={provider.accounts.length}
                                  />
                                </div>
                              </div>
                            </summary>

                            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                              <p className="text-xs text-text-muted">
                                这个号池下面的账号会一起管理，删除后只会软停用，历史任务保留。
                              </p>
                            </div>

                            <div className="mt-4 grid gap-3 xl:grid-cols-2">
                              <ProviderAccountCreateForm
                                providerId={provider.id}
                                defaultBaseUrl={provider.baseUrl}
                              />
                              <ProviderAccountImportForm
                                providerId={provider.id}
                              />
                            </div>

                            <details className="mt-4 rounded-[8px] border border-border bg-surface-2/35 p-4">
                              <summary className="cursor-pointer list-none text-sm font-medium">
                                账号明细与排障
                              </summary>
                              <div className="mt-3 grid gap-3">
                                {provider.accounts.map((account) => (
                                  <ProviderAccountEditForm
                                    key={account.id}
                                    providerId={provider.id}
                                    account={{
                                      ...account,
                                      cooldownUntil:
                                        account.cooldownUntil?.toISOString() ??
                                        null,
                                    }}
                                  />
                                ))}
                              </div>
                            </details>
                          </details>
                        ))}
                    </div>
                  </section>
                );
              },
            )}
          </div>
        </>
      ) : (
        <div className="surface-panel p-6 text-sm leading-6 text-text-muted">
          渠道服务暂不可用，请确认数据库连接后刷新。
        </div>
      )}
    </div>
  );
}
