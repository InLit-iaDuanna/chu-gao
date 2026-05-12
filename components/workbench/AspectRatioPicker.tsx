"use client";

import { cn } from "@/lib/utils";

const VISUAL_WIDTH: Record<string, string> = {
  "1:1": "w-12",
  "3:2": "w-14",
  "2:3": "w-10",
  "4:3": "w-14",
  "3:4": "w-10",
  "4:5": "w-10",
  "5:4": "w-14",
  "16:9": "w-16",
  "9:16": "w-9",
  "21:9": "w-20",
  "9:21": "w-8",
};

const VISUAL_HEIGHT: Record<string, string> = {
  "1:1": "h-12",
  "3:2": "h-10",
  "2:3": "h-14",
  "4:3": "h-11",
  "3:4": "h-14",
  "4:5": "h-14",
  "5:4": "h-11",
  "16:9": "h-9",
  "9:16": "h-16",
  "21:9": "h-8",
  "9:21": "h-20",
};

export function AspectRatioPicker({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {options.map((option) => {
        const active = option === value;

        return (
          <button
            key={option}
            type="button"
            className={cn(
              "selection-card flex items-center justify-center rounded-[12px] border p-3",
              active && "selection-card-active",
            )}
            aria-pressed={active}
            onClick={() => onChange(option)}
          >
            <div
              className={cn(
                "flex items-center justify-center rounded-[8px] border border-border bg-surface/70 font-mono text-xs text-text-muted transition-all duration-200",
                active &&
                  "border-border-strong bg-surface-2 text-foreground shadow-[inset_0_0_0_1px_rgb(var(--text)/0.03)]",
                VISUAL_WIDTH[option],
                VISUAL_HEIGHT[option],
              )}
            >
              {option}
            </div>
          </button>
        );
      })}
    </div>
  );
}
