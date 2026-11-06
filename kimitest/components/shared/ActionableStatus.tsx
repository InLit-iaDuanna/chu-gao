import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";

import { Button, Card } from "@/components/ui";
import { cn } from "@/lib/utils";

type ActionableStatusTone = "muted" | "warning" | "danger";

const toneClass: Record<ActionableStatusTone, string> = {
  muted: "bg-text-faint",
  warning: "bg-warning",
  danger: "bg-danger",
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
}): React.ReactElement {
  return (
    <Card
      className={cn("px-4 py-4 sm:px-5", className)}
      role={tone === "muted" ? "status" : "alert"}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-2 h-1.5 w-1.5 shrink-0 rounded-full",
            toneClass[tone],
          )}
        />
        <div className="min-w-0 flex-1">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-text-muted">
            {description}
          </p>
          {action || onRetry ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {onRetry ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onRetry}
                  leftIcon={<RefreshCw className="h-4 w-4 stroke-[1.5]" />}
                >
                  重试
                </Button>
              ) : null}
              {action}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
