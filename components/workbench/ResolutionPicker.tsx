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
            "selection-card rounded-[10px] border px-3 py-2.5 font-mono text-sm",
            value === option && "selection-card-active text-foreground",
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
