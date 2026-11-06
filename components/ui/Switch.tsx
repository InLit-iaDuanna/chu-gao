"use client";

import { cn } from "@/lib/utils";

interface SwitchProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange"
> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  size?: "sm" | "md";
}

export function Switch({
  checked,
  onChange,
  size = "md",
  className,
  ...props
}: SwitchProps): React.ReactElement {
  return (
    <button
      aria-checked={checked}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-border bg-surface-2 p-0.5 transition-colors duration-[var(--duration-fast)] ease-out hover:border-border-strong",
        checked && "border-foreground bg-foreground hover:border-foreground",
        size === "sm" ? "h-5 w-9" : "h-6 w-11",
        className,
      )}
      role="switch"
      type="button"
      {...props}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented && !props.disabled) onChange(!checked);
      }}
    >
      <span
        className={cn(
          "block rounded-full bg-foreground transition-transform duration-[var(--duration-fast)] ease-out",
          checked && "bg-background",
          size === "sm" ? "h-4 w-4" : "h-5 w-5",
          checked && (size === "sm" ? "translate-x-4" : "translate-x-5"),
        )}
      />
    </button>
  );
}
