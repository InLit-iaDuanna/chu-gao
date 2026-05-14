import { cn } from "@/lib/utils";

type BadgeVariant =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "outline";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClass: Record<BadgeVariant, string> = {
  neutral: "border-foreground/30 bg-foreground/[0.08] text-foreground",
  success: "border-success/30 bg-success/[0.08] text-success",
  warning: "border-warning/30 bg-warning/[0.08] text-warning",
  danger: "border-danger/30 bg-danger/[0.08] text-danger",
  info: "border-info/30 bg-info/[0.08] text-info",
  outline: "border-border bg-transparent text-text-muted",
};

export function Badge({
  variant = "neutral",
  className,
  ...props
}: BadgeProps): React.ReactElement {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-[4px] border px-1.5 text-[11px] font-medium leading-none",
        variantClass[variant],
        className,
      )}
      {...props}
    />
  );
}
