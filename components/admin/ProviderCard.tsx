import { ProviderHealthBadge } from "@/components/admin/ProviderHealthBadge";

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
    <div className="surface-panel p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-text-muted">{provider.protocol}</p>
          <h3 className="mt-1 text-lg font-semibold">{provider.name}</h3>
        </div>
        <ProviderHealthBadge health={provider.health} />
      </div>
      <p className="mt-3 text-sm text-text-muted">{provider.baseUrl}</p>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <span>优先级 {provider.priority}</span>
        <span>账号 {provider.accounts ?? 0}</span>
        <span>可用 {provider.availableAccounts ?? 0}</span>
        <span>
          并发 {provider.inFlight ?? 0}/{provider.maxConcurrency ?? 0}
        </span>
      </div>
      <p className="mt-2 text-sm text-text-muted">
        {provider.lastErrorMsg || "最近 24h 无错误"}
      </p>
    </div>
  );
}
