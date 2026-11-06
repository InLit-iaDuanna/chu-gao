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
          "z-[70] w-72 rounded-md border border-border bg-surface p-3 text-foreground shadow-[var(--shadow-md)] outline-none",
          className,
        )}
        {...props}
      />
    </RadixPopover.Portal>
  );
}
