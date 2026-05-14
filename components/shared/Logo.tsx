export function Logo() {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {/* Logo mark: two overlapping squares */}
      <div className="relative flex h-8 w-8 shrink-0 items-center justify-center">
        <div className="absolute h-5 w-5 rounded-[3px] border border-border-strong bg-surface" />
        <div className="absolute h-3 w-3 translate-x-1 translate-y-1 rounded-[2px] bg-foreground" />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[15px] font-semibold leading-none tracking-[-0.01em] text-foreground">
          初稿
        </span>
        <span className="mt-[3px] font-mono text-[10px] uppercase tracking-[0.16em] text-text-faint">
          Studio
        </span>
      </div>
    </div>
  );
}
