"use client";

import { cn } from "@/lib/utils";

export function ResolutionPicker({
  options,
  value,
  disabledOptions = [],
  onChange,
}: {
  options: string[];
  value?: string;
  disabledOptions?: string[];
  onChange: (next: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((option) => (
        (() => {
          const disabled = disabledOptions.includes(option);

          return (
            <button
              key={option}
              type="button"
              className={cn(
                "selection-card rounded-[10px] border px-3 py-2.5 font-mono text-sm",
                value === option && "selection-card-active text-foreground",
                disabled &&
                  "cursor-not-allowed opacity-35 hover:border-border hover:bg-surface",
              )}
              disabled={disabled}
              aria-pressed={value === option}
              title={disabled ? "当前比例不支持这个分辨率" : undefined}
              onClick={() => onChange(option)}
            >
              {option}
            </button>
          );
        })()
      ))}
    </div>
  );
}
