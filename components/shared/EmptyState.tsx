import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="surface-panel flex min-h-72 flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="space-y-2">
        <p className="text-xl font-semibold">{title}</p>
        <p className="max-w-md text-sm leading-6 text-text-muted">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}
