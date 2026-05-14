"use client";

import { createContext, useContext } from "react";

import { cn } from "@/lib/utils";

interface TabsContextValue {
  value: string;
  onChange: (value: string) => void;
}

interface TabsProps {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("Tabs components must be used inside Tabs.");
  }
  return context;
}

export function Tabs({
  value,
  onChange,
  children,
  className,
}: TabsProps): React.ReactElement {
  return (
    <TabsContext.Provider value={{ value, onChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn("flex border-b border-border", className)}
      role="tablist"
      {...props}
    />
  );
}

export function TabsTrigger({
  value,
  className,
  children,
  type = "button",
  ...props
}: TabsTriggerProps): React.ReactElement {
  const context = useTabsContext();
  const active = context.value === value;

  return (
    <button
      aria-selected={active}
      className={cn(
        "relative h-9 px-3 text-sm text-text-muted transition-colors hover:text-foreground",
        active &&
          "text-foreground after:absolute after:bottom-[-1px] after:left-0 after:h-0.5 after:w-full after:bg-foreground",
        className,
      )}
      role="tab"
      type={type}
      onClick={() => context.onChange(value)}
      {...props}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  value: string;
}): React.ReactElement | null {
  const context = useTabsContext();

  if (context.value !== value) {
    return null;
  }

  return <div className={cn("pt-4", className)} role="tabpanel" {...props} />;
}
