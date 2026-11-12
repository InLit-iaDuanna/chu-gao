"use client";

import * as RadixPopover from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverClose = RadixPopover.Close;

export function PopoverContent({
  className,
  align = "center",
  sideOffset = 6,
  ...props
}: React.ComponentPropsWithoutRef<
  typeof RadixPopover.Content
>): React.ReactElement {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "smooth-surface surface-overlay relative z-[70] w-72 max-w-[calc(100vw-24px)] rounded-xl border border-border bg-surface p-3 text-foreground shadow-[var(--shadow-lg)] outline-none",
          className,
        )}
        {...props}
      />
    </RadixPopover.Portal>
  );
}
