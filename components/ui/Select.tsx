"use client";

import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  name?: string;
  controlSize?: "sm" | "md" | "lg";
  className?: string;
  contentClassName?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

const sizeClass: Record<NonNullable<SelectProps["controlSize"]>, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-2.5 text-sm",
  lg: "h-10 px-3 text-sm",
};

export function Select({
  value,
  defaultValue,
  onValueChange,
  options,
  placeholder,
  disabled,
  invalid = false,
  name,
  controlSize = "md",
  className,
  contentClassName,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: SelectProps): React.ReactElement {
  return (
    <RadixSelect.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
      name={name}
    >
      <RadixSelect.Trigger
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={invalid || undefined}
        className={cn(
          "ui-select inline-flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface text-foreground outline-none transition-colors hover:border-border-strong focus:border-brand data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 aria-[invalid=true]:border-danger",
          sizeClass[controlSize],
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="shrink-0 text-text-muted">
          <ChevronDown size={14} aria-hidden="true" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={6}
          className={cn(
            "z-[70] max-h-[min(320px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-surface shadow-[var(--shadow-md)]",
            contentClassName,
          )}
        >
          <RadixSelect.ScrollUpButton className="flex h-7 items-center justify-center text-text-muted">
            <ChevronUp size={14} aria-hidden="true" />
          </RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative flex h-8 cursor-default select-none items-center rounded-[4px] py-1.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-45"
              >
                <span className="absolute left-2 inline-flex h-4 w-4 items-center justify-center">
                  <RadixSelect.ItemIndicator>
                    <Check size={13} aria-hidden="true" />
                  </RadixSelect.ItemIndicator>
                </span>
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
          <RadixSelect.ScrollDownButton className="flex h-7 items-center justify-center text-text-muted">
            <ChevronDown size={14} aria-hidden="true" />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
