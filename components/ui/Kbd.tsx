import { cn } from "@/lib/utils";

type KbdProps = React.HTMLAttributes<HTMLElement>;

export function Kbd({ className, ...props }: KbdProps): React.ReactElement {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-border bg-surface-2 px-1.5 font-mono text-[11px] text-text-muted shadow-[var(--shadow-xs)]",
        className,
      )}
      {...props}
    />
  );
}
