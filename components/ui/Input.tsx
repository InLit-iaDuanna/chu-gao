import { forwardRef } from "react";

import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  controlSize?: "sm" | "md" | "lg";
  /** @deprecated Use controlSize. */
  inputSize?: "sm" | "md" | "lg";
  invalid?: boolean;
}

const sizeClass: Record<NonNullable<InputProps["controlSize"]>, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-2.5 text-sm",
  lg: "h-10 px-3 text-sm",
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    controlSize,
    inputSize,
    invalid = false,
    className,
    "aria-invalid": ariaInvalid,
    ...props
  },
  ref,
): React.ReactElement {
  const resolvedSize = controlSize ?? inputSize ?? "md";

  return (
    <input
      ref={ref}
      className={cn(
        "ui-input w-full rounded-md border border-[rgb(var(--control-border))] bg-[rgb(var(--control-bg))] text-foreground outline-none transition-[background-color,border-color,color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)] placeholder:text-text-muted",
        "hover:border-[rgb(var(--control-border-hover))] hover:bg-[rgb(var(--control-bg-hover))] focus:border-[rgb(var(--control-focus))] focus:shadow-[var(--shadow-focus)] aria-[invalid=true]:border-danger",
        "disabled:cursor-not-allowed disabled:border-[rgb(var(--control-disabled-border))] disabled:bg-[rgb(var(--control-disabled-bg))] disabled:text-[rgb(var(--icon-disabled))] disabled:placeholder:text-[rgb(var(--icon-disabled))]",
        sizeClass[resolvedSize],
        className,
      )}
      aria-invalid={invalid ? true : ariaInvalid || undefined}
      {...props}
    />
  );
});
