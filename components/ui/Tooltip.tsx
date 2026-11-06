"use client";

import * as RadixTooltip from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

export const TooltipProvider = RadixTooltip.Provider;

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  className?: string;
}

export function Tooltip({
  content,
  children,
  side = "top",
  sideOffset = 6,
  className,
}: TooltipProps): React.ReactElement {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={sideOffset}
          className={cn(
            "z-[80] max-w-64 rounded-[4px] border border-border bg-surface px-2 py-1 text-xs leading-5 text-foreground shadow-[var(--shadow-md)]",
            className,
          )}
        >
          {content}
          <RadixTooltip.Arrow className="fill-border" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
