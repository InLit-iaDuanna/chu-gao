export function ProgressIndicator({
  label,
  progress,
  indeterminate = false,
}: {
  label: string;
  progress: number;
  indeterminate?: boolean;
}): React.ReactElement {
  const safeProgress = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-text-muted">
        <span>{label}</span>
        {!indeterminate ? <span>{safeProgress}%</span> : null}
      </div>
      <div className="h-0.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={
            indeterminate
              ? "h-full w-1/2 origin-left rounded-full bg-foreground [animation:indeterminate_1.2s_var(--ease-in-out)_infinite]"
              : "h-full rounded-full bg-foreground transition-all duration-[var(--duration-base)]"
          }
          style={indeterminate ? undefined : { width: `${safeProgress}%` }}
        />
      </div>
    </div>
  );
}
