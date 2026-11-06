export function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="surface-panel group relative p-4 transition-colors duration-150 hover:border-border-strong">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          {label}
        </p>
        <span
          aria-hidden
          className="h-1.5 w-1.5 bg-ink/20 transition-colors duration-150 group-hover:bg-brand"
        />
      </div>
      <p className="mt-3 font-serif text-[34px] leading-none tracking-[-0.02em] tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}
