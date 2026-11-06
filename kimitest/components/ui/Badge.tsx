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
  neutral: "border-border bg-surface text-foreground",
  success: "border-success/40 bg-success/[0.08] text-success",
  warning: "border-warning/40 bg-warning/[0.08] text-warning",
  danger: "border-danger/40 bg-danger/[0.08] text-danger",
  info: "border-info/40 bg-info/[0.08] text-info",
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
        "inline-flex h-5 items-center rounded-[3px] border px-2 font-mono text-[10px] font-medium uppercase leading-none tracking-[0.08em]",
        variantClass[variant],
        className,
      )}
      {...props}
    />
  );
}
