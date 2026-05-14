import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  selectSize?: "sm" | "md" | "lg";
}

const sizeClass: Record<NonNullable<SelectProps["selectSize"]>, string> = {
  sm: "h-7 pl-2.5 pr-8 text-xs",
  md: "h-8 pl-2.5 pr-8 text-sm",
  lg: "h-10 pl-3 pr-9 text-sm",
};

export function Select({
  selectSize = "md",
  className,
  children,
  ...props
}: SelectProps): React.ReactElement {
  return (
    <span className="relative inline-flex w-full">
      <select
        className={cn(
          "w-full appearance-none rounded-md border border-border bg-surface text-foreground outline-none transition-colors hover:border-border-strong focus:border-foreground focus:shadow-[var(--shadow-focus)]",
          sizeClass[selectSize],
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint"
        strokeWidth={1.6}
      />
    </span>
  );
}
