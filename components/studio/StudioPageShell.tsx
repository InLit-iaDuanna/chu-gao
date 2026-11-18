import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface StudioPageShellProps {
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}

export function StudioPageShell({
  title,
  eyebrow,
  actions,
  wide = false,
  children,
}: StudioPageShellProps) {
  return (
    <div className="h-full min-h-0 min-w-0 overflow-y-auto">
      <div
        className={cn(
          "mx-auto flex min-w-0 w-full flex-col px-4 py-6 sm:px-6",
          wide ? "max-w-7xl" : "max-w-4xl",
        )}
      >
        <header className="app-page-header mb-6">
          <div className="min-w-0">
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h1 className="app-page-title mt-1 break-words">{title}</h1>
          </div>
          {actions ? (
            <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
              {actions}
            </div>
          ) : null}
        </header>
        {children}
      </div>
    </div>
  );
}
