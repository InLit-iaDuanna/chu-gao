import { healthLabel } from "@/lib/admin-labels";

export function ProviderHealthBadge({
  health,
}: {
  health: "HEALTHY" | "DEGRADED" | "DOWN";
}) {
  const tone =
    health === "HEALTHY"
      ? "admin-status-healthy"
      : health === "DEGRADED"
        ? "admin-status-degraded"
        : "admin-status-down";

  return <span className={`admin-status ${tone}`}>{healthLabel(health)}</span>;
}
