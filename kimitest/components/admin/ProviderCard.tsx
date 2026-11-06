import { ProviderHealthBadge } from "@/components/admin/ProviderHealthBadge";
import { providerProtocolLabel } from "@/lib/admin-labels";

export function ProviderCard({
  provider,
}: {
  provider: {
    name: string;
    protocol: string;
    baseUrl: string;
    priority: number;
    health: "HEALTHY" | "DEGRADED" | "DOWN";
    lastErrorMsg: string;
    accounts?: number;
    availableAccounts?: number;
    inFlight?: number;
    maxConcurrency?: number;
  };
}) {
  return (
    <div className="surface-panel min-w-0 p-4">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">{providerProtocolLabel(provider.protocol)}</p>
          <h3 className="mt-1.5 break-words text-base font-semibold tracking-tight">
            {provider.name}
          </h3>
        </div>
        <ProviderHealthBadge health={provider.health} />
      </div>
      <p className="mt-2 break-all font-mono text-xs text-text-muted">
        {provider.baseUrl}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="admin-metric">
          <span className="admin-metric-label">优先级</span>
          <span className="admin-metric-value">{provider.priority}</span>
        </div>
        <div className="admin-metric">
          <span className="admin-metric-label">账号</span>
          <span className="admin-metric-value">{provider.accounts ?? 0}</span>
        </div>
        <div className="admin-metric">
          <span className="admin-metric-label">可用</span>
          <span className="admin-metric-value">
            {provider.availableAccounts ?? 0}
          </span>
        </div>
        <div className="admin-metric">
          <span className="admin-metric-label">并发</span>
          <span className="admin-metric-value">
            {provider.inFlight ?? 0}/{provider.maxConcurrency ?? 0}
          </span>
        </div>
      </div>
      <p className="mt-3 break-words text-xs leading-5 text-text-faint">
        {provider.lastErrorMsg || "最近 24h 无错误"}
      </p>
    </div>
  );
}
