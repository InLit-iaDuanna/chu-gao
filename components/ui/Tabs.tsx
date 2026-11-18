"use client";

import * as RadixTabs from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

export const Tabs = RadixTabs.Root;

export function TabsList({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixTabs.List>): React.ReactElement {
  return (
    <RadixTabs.List
      className={cn("inline-flex rounded-md bg-surface-2 p-0.5", className)}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentPropsWithoutRef<
  typeof RadixTabs.Trigger
>): React.ReactElement {
  return (
    <RadixTabs.Trigger
      className={cn(
        "h-8 shrink-0 whitespace-nowrap rounded-sm px-3 text-xs font-medium text-text-muted outline-none transition-colors hover:text-foreground focus:shadow-[var(--shadow-focus)] data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow-[var(--shadow-xs)] disabled:text-[rgb(var(--icon-disabled))]",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<
  typeof RadixTabs.Content
>): React.ReactElement {
  return (
    <RadixTabs.Content
      className={cn(
        "outline-none focus-visible:shadow-[var(--shadow-focus)]",
        className,
      )}
      {...props}
    />
  );
}
