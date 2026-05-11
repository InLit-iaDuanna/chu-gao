import type { ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";

type ActionableStatusTone = "muted" | "warning" | "danger";

const toneClass: Record<ActionableStatusTone, string> = {
  muted: "border-border text-text-muted",
  warning: "border-warning/35 text-warning",
  danger: "border-danger/35 text-danger",
};

export function ActionableStatus({
  tone = "muted",
  eyebrow,
  title,
  description,
  action,
  onRetry,
  className,
}: {
  tone?: ActionableStatusTone;
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "surface-panel px-4 py-4 sm:px-5",
        toneClass[tone],
        className,
      )}
      role={tone === "muted" ? "status" : "alert"}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-1 h-4 w-4 shrink-0 stroke-[1.5]" />
        <div className="min-w-0 flex-1">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2 className="text-base font-medium text-foreground">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-text-muted">
            {description}
          </p>
          {action || onRetry ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {onRetry ? (
                <button
                  type="button"
                  className="tool-button h-9 text-text-muted"
                  onClick={onRetry}
                >
                  <RefreshCw className="h-4 w-4 stroke-[1.5]" />
                  重试
                </button>
              ) : null}
              {action}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
