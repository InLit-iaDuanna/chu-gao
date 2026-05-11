export function ProviderHealthBadge({
  health,
}: {
  health: "HEALTHY" | "DEGRADED" | "DOWN";
}) {
  const color =
    health === "HEALTHY"
      ? "text-success"
      : health === "DEGRADED"
        ? "text-warning"
        : "text-danger";

  return <span className={`text-xs font-medium ${color}`}>{health}</span>;
}
