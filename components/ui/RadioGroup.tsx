"use client";

import * as RadixRadioGroup from "@radix-ui/react-radio-group";

import { cn } from "@/lib/utils";

export interface RadioOption {
  value: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: RadioOption[];
  disabled?: boolean;
  name?: string;
  orientation?: "horizontal" | "vertical";
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export function RadioGroup({
  options,
  orientation = "vertical",
  className,
  ...props
}: RadioGroupProps): React.ReactElement {
  return (
    <RadixRadioGroup.Root
      className={cn(
        "flex gap-3",
        orientation === "vertical" ? "flex-col" : "flex-row flex-wrap",
        className,
      )}
      orientation={orientation}
      {...props}
    >
      {options.map((option) => {
        const id = `${props.name ?? "radio"}-${option.value}`;
        return (
          <label
            key={option.value}
            htmlFor={id}
            className="flex cursor-pointer items-start gap-2.5"
          >
            <RadixRadioGroup.Item
              id={id}
              value={option.value}
              disabled={option.disabled}
              className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border bg-surface outline-none transition-colors hover:border-border-strong focus:shadow-[var(--shadow-focus)] data-[state=checked]:border-foreground disabled:cursor-not-allowed disabled:opacity-45"
            >
              <RadixRadioGroup.Indicator className="h-2 w-2 rounded-full bg-foreground" />
            </RadixRadioGroup.Item>
            <span className="min-w-0 text-sm">
              <span className="block text-foreground">{option.label}</span>
              {option.description ? (
                <span className="mt-0.5 block text-xs text-text-muted">
                  {option.description}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </RadixRadioGroup.Root>
  );
}
