"use client";

import { cn } from "@/lib/utils";

interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  "aria-label": ariaLabel,
}: SegmentedProps<T>): React.ReactElement {
  return (
    <div
      aria-label={ariaLabel}
      className={cn("inline-flex rounded-md bg-surface-2 p-0.5", className)}
      role="radiogroup"
    >
      {options.map((option) => {
        const active = option.value === value;

        return (
          <button
            key={option.value}
            aria-checked={active}
            className={cn(
              "h-7 rounded-[4px] px-2.5 text-xs text-text-muted transition-colors duration-[var(--duration-fast)]",
              active && "bg-surface text-foreground shadow-[var(--shadow-xs)]",
              !active && "hover:text-foreground",
            )}
            disabled={option.disabled}
            role="radio"
            type="button"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
