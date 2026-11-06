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
    <div className="h-full overflow-y-auto">
      <div
        className={cn(
          "mx-auto flex w-full flex-col px-4 pb-10 pt-5 sm:px-6 sm:pb-16 sm:pt-8",
          wide ? "max-w-7xl" : "max-w-4xl",
        )}
      >
        <header className="flex flex-wrap items-end justify-between gap-3 pb-5 sm:gap-4 sm:pb-6">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
              {title}
            </h1>
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
