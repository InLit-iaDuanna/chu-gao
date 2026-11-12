"use client";

import { useRef } from "react";

import { cn } from "@/lib/utils";

interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Accessible name — required when the label is icon-only. */
  ariaLabel?: string;
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
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const activeIndex = options.findIndex((option) => option.value === value);
  const rovingIndex = activeIndex >= 0 ? activeIndex : 0;

  function select(index: number): void {
    const option = options[index];
    if (!option || option.disabled) {
      return;
    }
    refs.current[index]?.focus();
    onChange(option.value);
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    const last = options.length - 1;
    let next = index;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = index === 0 ? last : index - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    select(next);
  }

  return (
    <div
      aria-label={ariaLabel}
      className={cn("inline-flex rounded-md bg-surface-2 p-0.5", className)}
      role="radiogroup"
    >
      {options.map((option, index) => {
        const active = option.value === value;

        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            aria-checked={active}
            aria-label={option.ariaLabel}
            title={option.ariaLabel}
            tabIndex={index === rovingIndex ? 0 : -1}
            className={cn(
              "smooth-surface ui-segment relative h-7 rounded-md px-2.5 text-xs text-text-muted transition-colors duration-[var(--duration-fast)]",
              active && "bg-surface text-foreground shadow-[var(--shadow-xs)]",
              !active && "hover:text-foreground",
            )}
            disabled={option.disabled}
            role="radio"
            type="button"
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
