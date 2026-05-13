export function ProgressIndicator({
  label,
  progress,
}: {
  label: string;
  progress: number;
}) {
  const safeProgress = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm text-text-muted">
        <span>{label}</span>
        <span>{safeProgress}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-foreground transition-all duration-300"
          style={{ width: `${safeProgress}%` }}
        />
      </div>
    </div>
  );
}
