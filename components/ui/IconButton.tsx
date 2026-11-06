"use client";

import { cloneElement, isValidElement } from "react";

import { cn } from "@/lib/utils";

import { Spinner } from "./Spinner";

export type IconButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "selected"
  | "danger";
export type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  children: React.ReactElement;
  asChild?: boolean;
  loading?: boolean;
  selected?: boolean;
}

const variantClass: Record<IconButtonVariant, string> = {
  primary:
    "border border-transparent bg-[rgb(var(--brand-primary))] text-on-accent hover:bg-[rgb(var(--brand-primary))]/88",
  secondary:
    "border border-[rgb(var(--control-border))] bg-[rgb(var(--control-bg))] text-[rgb(var(--icon))] hover:border-[rgb(var(--control-border-hover))] hover:bg-[rgb(var(--control-bg-hover))]",
  outline:
    "border border-[rgb(var(--control-border))] bg-transparent text-[rgb(var(--icon-muted))] hover:border-[rgb(var(--control-border-hover))] hover:bg-[rgb(var(--control-bg-hover))] hover:text-[rgb(var(--icon))]",
  ghost:
    "border border-transparent bg-transparent text-[rgb(var(--icon-muted))] hover:bg-[rgb(var(--control-bg-hover))] hover:text-[rgb(var(--icon))]",
  selected:
    "border border-[rgb(var(--control-selected-border))] bg-[rgb(var(--control-selected-bg))] text-[rgb(var(--icon-selected))]",
  danger:
    "border border-transparent bg-transparent text-danger hover:border-[rgb(var(--danger))]/40 hover:bg-danger/10",
};

const disabledClass =
  "aria-disabled:border-[rgb(var(--control-disabled-border))] aria-disabled:bg-[rgb(var(--control-disabled-bg))] aria-disabled:text-[rgb(var(--icon-disabled))]";

const sizeClass: Record<IconButtonSize, string> = {
  sm: "h-7 w-7",
  md: "h-8 w-8",
  lg: "h-10 w-10",
};

const iconSize: Record<IconButtonSize, number> = {
  sm: 12,
  md: 14,
  lg: 16,
};

const spinnerSize: Record<IconButtonSize, "sm" | "md"> = {
  sm: "sm",
  md: "sm",
  lg: "md",
};

export function IconButton({
  variant = "ghost",
  size = "md",
  className,
  children,
  asChild = false,
  loading = false,
  selected,
  disabled,
  "aria-pressed": ariaPressed,
  type = "button",
  ...props
}: IconButtonProps): React.ReactElement {
  const effectiveVariant = selected ? "selected" : variant;
  const selectedState =
    ariaPressed ?? selected ?? (variant === "selected" ? true : undefined);
  const classes = cn(
    "inline-flex shrink-0 items-center justify-center rounded-md transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "active:translate-y-px motion-reduce:active:translate-y-0",
    "disabled:cursor-not-allowed disabled:opacity-100 disabled:active:translate-y-0",
    sizeClass[size],
    variantClass[effectiveVariant],
    disabledClass,
    className,
  );

  if (asChild && isValidElement(children)) {
    return cloneElement(
      children,
      {
        className: cn(
          (children.props as { className?: string }).className,
          classes,
        ),
        "aria-busy": loading || undefined,
        "aria-disabled": disabled || loading ? true : undefined,
        "aria-pressed": selectedState,
        "data-selected": selectedState || undefined,
        "data-disabled": disabled || loading ? true : undefined,
        ...props,
      } as React.HTMLAttributes<HTMLElement> & {
        children?: React.ReactNode;
      },
      loading ? (
        <Spinner className="shrink-0" size={spinnerSize[size]} />
      ) : (
        (children.props as { children?: React.ReactNode }).children
      ),
    );
  }

  const childProps = children.props as React.SVGProps<SVGSVGElement> & {
    size?: number | string;
  };
  const icon = cloneElement(children, {
    size: childProps.size ?? iconSize[size],
    strokeWidth: childProps.strokeWidth ?? 2,
    className: cn(childProps.className, "shrink-0"),
    "aria-hidden": true,
  } as React.SVGProps<SVGSVGElement>);

  return (
    <button
      className={classes}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-disabled={disabled || loading ? true : undefined}
      aria-pressed={selectedState}
      data-selected={selectedState || undefined}
      data-disabled={disabled || loading ? true : undefined}
      {...props}
    >
      {loading ? (
        <Spinner className="shrink-0" size={spinnerSize[size]} />
      ) : (
        icon
      )}
    </button>
  );
}
