"use client";

import { cn } from "@/lib/utils";

export type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  hoverable?: boolean;
};

export function Card({
  className,
  hoverable = false,
  ...props
}: CardProps): React.ReactElement {
  const classes = cn(
    "bg-surface border border-border rounded-lg transition-colors duration-[var(--duration-base)]",
    hoverable && "hover:border-border-strong hover:bg-surface-2",
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
