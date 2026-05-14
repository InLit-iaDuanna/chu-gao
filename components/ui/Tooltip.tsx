import { cn } from "@/lib/utils";

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Tooltip({
  content,
  children,
  className,
}: TooltipProps): React.ReactElement {
  return (
    <span className={cn("group relative inline-flex", className)}>
      {children}
      <span className="pointer-events-none absolute left-1/2 top-[calc(100%+6px)] z-50 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-[11px] text-background opacity-0 shadow-[var(--shadow-sm)] transition-opacity delay-200 duration-[var(--duration-fast)] group-hover:opacity-100">
        {content}
      </span>
    </span>
  );
}
