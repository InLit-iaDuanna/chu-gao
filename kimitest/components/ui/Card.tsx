"use client";

import { cn } from "@/lib/utils";

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  brutal?: boolean;
  hoverable?: boolean;
};

export function Card({
  className,
  brutal = false,
  hoverable = false,
  ...props
}: CardProps): React.ReactElement {
  const classes = cn(
    "transition-[transform,border-color,background-color] duration-[var(--duration-base)]",
    // Legacy brutal prop → 纸面卡片（契约保留，视觉统一）
    "rounded-[var(--radius-lg)] border border-border bg-surface",
    hoverable &&
      "hover:-translate-y-0.5 hover:border-border-strong motion-reduce:transform-none",
    brutal && "bg-surface-2",
    className,
  );

  return <div className={classes} {...props} />;
}

export function CardHeader({
  className,
  ...props
}: CardProps): React.ReactElement {
  return <div className={cn("px-5 pb-3 pt-5", className)} {...props} />;
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>): React.ReactElement {
  return (
    <h3
      className={cn("text-sm font-semibold tracking-[-0.01em]", className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>): React.ReactElement {
  return (
    <p className={cn("mt-1 text-xs text-text-muted", className)} {...props} />
  );
}

export function CardContent({
  className,
  ...props
}: CardProps): React.ReactElement {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: CardProps): React.ReactElement {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 border-t border-border px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}
