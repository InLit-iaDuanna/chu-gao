"use client";

import { cn } from "@/lib/utils";

export function ResolutionPicker({
  options,
  value,
  onChange,
}: {
  options: string[];
  value?: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={cn(
            "surface-panel px-3 py-2 font-mono text-sm transition-colors hover:bg-surface-2",
            value === option &&
              "border-border-strong bg-surface-2 text-foreground",
          )}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
