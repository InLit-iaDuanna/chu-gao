import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
}

export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  className,
  ...props
}: EmptyStateProps): React.ReactElement {
  return (
    <div
      className={cn(
        "flex min-h-40 flex-col items-center justify-center px-6 py-10 text-center",
        className,
      )}
      {...props}
    >
      {Icon ? (
        <Icon
          className="mb-3 h-5 w-5 text-text-faint"
          strokeWidth={1.5}
          aria-hidden="true"
        />
      ) : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 max-w-md text-xs leading-5 text-text-muted">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
