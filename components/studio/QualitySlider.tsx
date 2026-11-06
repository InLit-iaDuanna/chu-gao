"use client";

import type { ImageQuality } from "@/lib/models/types";
import { cn } from "@/lib/utils";

const QUALITY_LABELS: Record<ImageQuality, string> = {
  auto: "自动",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "最高",
};

export function qualityLabel(value?: string): string {
  if (!value) return "自动";
  return QUALITY_LABELS[value as ImageQuality] ?? value;
}

export function QualitySlider({
  options,
  value,
  onChange,
  disabled = false,
  compact = false,
  ariaLabel = "生成质量",
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
  ariaLabel?: string;
}) {
  if (options.length === 0) return null;

  const fallback = options[0] ?? "auto";
  const selectedIndex = Math.max(0, options.indexOf(value));
  const progress =
    options.length === 1 ? 0 : (selectedIndex / (options.length - 1)) * 100;

  return (
    <div className={cn("w-full", disabled && "opacity-55")}>
      <div className={cn("relative", compact ? "h-5" : "h-6")}>
        <div
          className={cn(
            "pointer-events-none absolute left-2 right-2 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-surface-3",
            compact && "left-1.5 right-1.5 h-0.5",
          )}
        >
          <div
            className="h-full bg-foreground transition-[width] duration-150"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="pointer-events-none absolute inset-x-2 inset-y-0 flex items-center justify-between">
          {options.map((option, index) => (
            <span
              key={option}
              className={cn(
                "h-1.5 w-1.5 rounded-full border border-surface-3 bg-surface",
                index <= selectedIndex && "border-foreground bg-foreground",
                compact && "h-1 w-1",
              )}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(0, options.length - 1)}
          step={1}
          value={selectedIndex}
          disabled={disabled || options.length === 1}
          aria-label={ariaLabel}
          aria-valuetext={qualityLabel(options[selectedIndex] ?? fallback)}
          onChange={(event) =>
            onChange(options[Number(event.target.value)] ?? fallback)
          }
          className={cn(
            "absolute inset-y-0 left-2 right-2 z-10 m-0 h-full w-auto cursor-pointer appearance-none bg-transparent outline-none disabled:cursor-not-allowed",
            "[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:bg-transparent",
            "[&::-webkit-slider-thumb]:mt-[-6px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-surface [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-sm",
            "[&::-moz-range-track]:h-1 [&::-moz-range-track]:bg-transparent",
            "[&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-surface [&::-moz-range-thumb]:bg-foreground [&::-moz-range-thumb]:shadow-sm",
            compact &&
              "[&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:w-2.5",
          )}
        />
      </div>
      <div
        className={cn(
          "grid text-[10px] text-text-faint",
          compact ? "mt-0" : "mt-0.5",
        )}
        style={{
          gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        }}
      >
        {options.map((option, index) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option)}
            className={cn(
              "min-w-0 truncate px-0.5 text-center transition-colors hover:text-foreground disabled:cursor-not-allowed",
              option === options[selectedIndex] &&
                "font-medium text-foreground",
              index === 0 && "text-left",
              index === options.length - 1 && "text-right",
            )}
          >
            {qualityLabel(option)}
          </button>
        ))}
      </div>
    </div>
  );
}
