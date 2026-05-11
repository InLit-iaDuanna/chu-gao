export function Logo() {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] border border-border bg-surface">
        <div className="h-2.5 w-2.5 rounded-[2px] bg-foreground" />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[15px] font-medium leading-none text-foreground">
          初稿
        </span>
        <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
          Workspace
        </span>
      </div>
    </div>
  );
}
