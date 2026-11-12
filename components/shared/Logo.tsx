import { cn } from "@/lib/utils";

interface LogoProps {
  size?: "sm" | "md";
  className?: string;
}

export function Logo({
  size = "md",
  className,
}: LogoProps): React.ReactElement {
  const compact = size === "sm";

  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <div className="relative flex h-6 w-6 shrink-0 items-center justify-center text-foreground">
        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 16 16">
          <rect
            x="2.5"
            y="2.5"
            width="8"
            height="8"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
          <rect x="6" y="6" width="7" height="7" rx="1.2" fill="currentColor" />
        </svg>
      </div>
      {!compact ? (
        <span className="truncate text-[14px] font-semibold leading-none tracking-[-0.01em] text-foreground">
          Chūgǎo
        </span>
      ) : null}
    </div>
  );
}
