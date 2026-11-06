"use client";

import { useMemo, useState } from "react";

import {
  ProviderAccountCreateForm,
  ProviderAccountEditForm,
  ProviderAccountImportForm,
} from "@/components/admin/ProviderAccountAdminForms";
import {
  ProviderCreateForm,
  ProviderPoolActions,
} from "@/components/admin/ProviderAdminForms";
import { ChannelRequestConfigForm } from "@/components/admin/ChannelRequestConfigForm";
import { ChannelSettingsForm } from "@/components/admin/ChannelSettingsForm";
import type { ChannelRequestConfig } from "@/lib/provider-channel-request-config";
import {
  HEALTH_LABELS,
  PROVIDER_PROTOCOL_LABELS,
  providerProtocolLabel,
} from "@/lib/admin-labels";
import { cn } from "@/lib/utils";

type ChannelHealth = "HEALTHY" | "DEGRADED" | "DOWN";

/** 序列化后的账号：cooldownUntil 已转成 ISO 字符串，结构兼容 ProviderAccountEditForm。 */
export type ConsoleAccount = {
  id: string;
  name: string | null;
  baseUrl: string;
  apiKeyFingerprintMasked: string;
  priority: number;
  weight: number;
  maxConcurrency: number;
  inFlight: number;
  health: ChannelHealth;
  isActive: boolean;
  consecutiveErrors: number;
  cooldownUntil: string | null;
  dailyLimit: number | null;
  dailyUsed: number;
  note: string | null;
  lastErrorMsg: string | null;
  hasApiKey: boolean;
  isDefault: boolean;
};

export type ConsoleChannel = {
  providerId: string;
  providerName: string;
  protocol: string;
  modelsSupported: string[];
  baseUrl: string;
  displayName: string;
  health: ChannelHealth;
  accountCount: number;
  activeAccountCount: number;
  healthyAccountCount: number;
  inFlight: number;
  maxConcurrency: number;
  dailyUsed: number;
  dailyLimit: number | null;
  accounts: ConsoleAccount[];
  requestConfig: ChannelRequestConfig;
};

const PROTOCOL_LABELS: Record<string, string> = {
  ...PROVIDER_PROTOCOL_LABELS,
};

const HEALTH_TONE: Record<ChannelHealth, string> = {
  HEALTHY: "admin-status-healthy",
  DEGRADED: "admin-status-degraded",
  DOWN: "admin-status-down",
};

const HEALTH_LABEL: Record<ChannelHealth, string> = {
  ...HEALTH_LABELS,
};

const HEALTH_DOT: Record<ChannelHealth, string> = {
  HEALTHY: "bg-[rgb(var(--success))]",
  DEGRADED: "bg-[rgb(var(--warning))]",
  DOWN: "bg-[rgb(var(--danger))]",
};

type TabId = "accounts" | "request" | "settings";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "accounts", label: "账号" },
  { id: "request", label: "请求格式" },
  { id: "settings", label: "设置" },
];

function channelKey(channel: Pick<ConsoleChannel, "providerId" | "baseUrl">) {
  return `${channel.providerId}:${channel.baseUrl}`;
}

function ChannelDot({ health }: { health: ChannelHealth }) {
  return (
    <span
      aria-hidden
      className={cn("h-2 w-2 flex-none rounded-full", HEALTH_DOT[health])}
    />
  );
}

export function ProviderConsole({
  channels,
  models,
}: {
  channels: ConsoleChannel[];
  models: Array<{ id: string; protocol: string }>;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(
    channels.length > 0 ? channelKey(channels[0]) : null,
  );
  const [activeTab, setActiveTab] = useState<TabId>("accounts");
  const [creating, setCreating] = useState(channels.length === 0);

  const groupedByProtocol = useMemo(() => {
    const groups = new Map<string, ConsoleChannel[]>();
    for (const channel of channels) {
      groups.set(channel.protocol, [
        ...(groups.get(channel.protocol) ?? []),
        channel,
      ]);
    }
    return Array.from(groups.entries()).sort(([left], [right]) =>
      left.localeCompare(right),
    );
  }, [channels]);

  const selectedChannel = useMemo(
    () =>
      channels.find((channel) => channelKey(channel) === selectedKey) ?? null,
    [channels, selectedKey],
  );

  function selectChannel(key: string) {
    setSelectedKey(key);
    setCreating(false);
    setActiveTab("accounts");
  }

  function startCreating() {
    setCreating(true);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
      {/* ── LEFT RAIL ─────────────────────────────────────────────── */}
      <nav
        aria-label="渠道列表"
        className="surface-panel-soft flex max-h-[70vh] flex-col overflow-hidden p-0 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)]"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <p className="eyebrow">渠道列表</p>
          <span className="text-xs text-text-faint">{channels.length}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {groupedByProtocol.length === 0 ? (
            <p className="px-2 py-3 text-xs text-text-faint">
              还没有渠道。点击下方新建。
            </p>
          ) : (
            groupedByProtocol.map(([protocol, protocolChannels]) => (
              <div key={protocol} className="mb-3 last:mb-0">
                <p className="px-2 pb-1 pt-2 font-mono text-[10px] uppercase tracking-wider text-text-faint">
                  {PROTOCOL_LABELS[protocol] ?? protocol}
                </p>
                <ul className="space-y-0.5">
                  {protocolChannels.map((channel) => {
                    const key = channelKey(channel);
                    const isSelected = !creating && key === selectedKey;
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          aria-current={isSelected ? "true" : undefined}
                          onClick={() => selectChannel(key)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-sm transition-colors",
                            "hover:bg-surface-2/60",
                            isSelected
                              ? "bg-surface-2 text-foreground ring-1 ring-border"
                              : "text-text-muted",
                          )}
                        >
                          <ChannelDot health={channel.health} />
                          <span className="min-w-0 flex-1 truncate">
                            {channel.displayName}
                          </span>
                          <span className="flex-none font-mono text-[11px] tabular-nums text-text-faint">
                            {channel.healthyAccountCount}/{channel.accountCount}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={startCreating}
            aria-current={creating ? "true" : undefined}
            className={cn(
              "flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-sm font-medium transition-colors hover:bg-surface-2/60",
              creating
                ? "bg-surface-2 text-foreground ring-1 ring-border"
                : "text-text-muted",
            )}
          >
            <span aria-hidden className="text-base leading-none">
              ＋
            </span>
            新建渠道
          </button>
        </div>
      </nav>

      {/* ── RIGHT PANE ────────────────────────────────────────────── */}
      <div className="min-w-0">
        {creating ? (
          <section className="surface-panel space-y-4 p-5">
            <div>
              <p className="eyebrow">新建</p>
              <h2 className="mt-1.5 text-lg font-semibold tracking-tight">
                新建渠道（号池）
              </h2>
              <p className="mt-1 text-xs leading-5 text-text-faint">
                创建一个新的号池后，会按 Base URL 自动归入对应大渠道。
              </p>
            </div>
            <ProviderCreateForm models={models} />
          </section>
        ) : selectedChannel ? (
          <ChannelDetail channel={selectedChannel} activeTab={activeTab} onTabChange={setActiveTab} />
        ) : (
          <section className="surface-panel space-y-4 p-6">
            <div>
              <p className="eyebrow">还没有渠道</p>
              <h2 className="mt-1.5 text-lg font-semibold tracking-tight">
                先创建一个号池
              </h2>
              <p className="mt-1 text-sm leading-6 text-text-muted">
                创建号池或导入 API 后，渠道会出现在左侧列表里。
              </p>
            </div>
            <ProviderCreateForm models={models} />
          </section>
        )}
      </div>
    </div>
  );
}

function ChannelDetail({
  channel,
  activeTab,
  onTabChange,
}: {
  channel: ConsoleChannel;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}) {
  const tablistId = `channel-tabs-${channel.providerId}`;

  return (
    <section className="surface-panel min-w-0 p-5">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">
              {channel.displayName}
            </h2>
            <span className={`admin-status ${HEALTH_TONE[channel.health]}`}>
              {HEALTH_LABEL[channel.health]}
            </span>
          </div>
          <p className="mt-1.5 break-all font-mono text-xs text-text-muted">
            {channel.baseUrl}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-faint">
            <span className="admin-pill">{providerProtocolLabel(channel.protocol)}</span>
            <span>{channel.providerName} 号池</span>
            <span>·</span>
            <span>{channel.modelsSupported.join(", ") || "未标模型"}</span>
          </p>
        </div>
      </header>

      {/* Stat strip */}
      <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
        <div className="admin-metric">
          <span className="admin-metric-label">启用</span>
          <span className="admin-metric-value">{channel.activeAccountCount}</span>
        </div>
        <div className="admin-metric">
          <span className="admin-metric-label">并发</span>
          <span className="admin-metric-value">
            {channel.inFlight}/{channel.maxConcurrency}
          </span>
        </div>
        <div className="admin-metric">
          <span className="admin-metric-label">今日</span>
          <span className="admin-metric-value">
            {channel.dailyUsed}/{channel.dailyLimit ?? "∞"}
          </span>
        </div>
        <div className="admin-metric">
          <span className="admin-metric-label">账号</span>
          <span className="admin-metric-value">{channel.accountCount}</span>
        </div>
      </div>

      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="渠道详情"
        id={tablistId}
        className="mt-5 flex gap-1 border-b border-border"
      >
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              id={`${tablistId}-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`${tablistId}-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-[rgb(var(--brand-primary))] text-foreground"
                  : "border-transparent text-text-muted hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab panels */}
      <div className="mt-4">
        {activeTab === "accounts" ? (
          <div
            role="tabpanel"
            id={`${tablistId}-panel-accounts`}
            aria-labelledby={`${tablistId}-accounts`}
            className="space-y-4"
          >
            <div className="space-y-3">
              {channel.accounts.length === 0 ? (
                <p className="text-sm text-text-muted">
                  这个渠道还没有账号。在下面添加或导入。
                </p>
              ) : (
                channel.accounts.map((account) => (
                  <ProviderAccountEditForm
                    key={account.id}
                    providerId={channel.providerId}
                    account={account}
                  />
                ))
              )}
            </div>

            <div className="space-y-3 border-t border-border pt-4">
              <p className="eyebrow">添加 / 导入账号</p>
              <div className="grid gap-3 xl:grid-cols-2">
                <ProviderAccountCreateForm
                  providerId={channel.providerId}
                  defaultBaseUrl={channel.baseUrl}
                  compact
                />
                <ProviderAccountImportForm providerId={channel.providerId} />
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "request" ? (
          <div
            role="tabpanel"
            id={`${tablistId}-panel-request`}
            aria-labelledby={`${tablistId}-request`}
          >
            <ChannelRequestConfigForm
              baseUrl={channel.baseUrl}
              initial={channel.requestConfig}
            />
          </div>
        ) : null}

        {activeTab === "settings" ? (
          <div
            role="tabpanel"
            id={`${tablistId}-panel-settings`}
            aria-labelledby={`${tablistId}-settings`}
            className="space-y-5"
          >
            <ChannelSettingsForm
              providerId={channel.providerId}
              baseUrl={channel.baseUrl}
              displayName={channel.displayName}
              maxConcurrency={channel.maxConcurrency}
              accountCount={channel.accountCount}
            />

            <div className="space-y-2 border-t border-border pt-4">
              <p className="eyebrow">号池操作</p>
              <p className="text-xs leading-5 text-text-faint">
                删除整个号池会停用它下面的全部账号，历史任务会保留。
              </p>
              <ProviderPoolActions
                providerId={channel.providerId}
                providerName={channel.providerName}
                accountCount={channel.accountCount}
              />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
