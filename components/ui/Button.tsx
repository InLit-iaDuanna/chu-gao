"use client";

import { cloneElement, forwardRef, isValidElement } from "react";

import { cn } from "@/lib/utils";

import { Spinner } from "./Spinner";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "link";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  asChild?: boolean;
  children?: React.ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "border border-transparent bg-[rgb(var(--brand-primary))] text-on-accent hover:bg-[rgb(var(--brand-primary))]/88 disabled:border-[rgb(var(--control-disabled-border))] disabled:bg-[rgb(var(--control-disabled-bg))] disabled:text-[rgb(var(--icon-disabled))]",
  secondary:
    "border border-[rgb(var(--control-border))] bg-[rgb(var(--control-bg))] text-foreground hover:border-[rgb(var(--control-border-hover))] hover:bg-[rgb(var(--control-bg-hover))] disabled:border-[rgb(var(--control-disabled-border))] disabled:bg-[rgb(var(--control-disabled-bg))] disabled:text-[rgb(var(--icon-disabled))]",
  ghost:
    "border border-transparent text-[rgb(var(--icon-muted))] hover:bg-[rgb(var(--control-bg-hover))] hover:text-[rgb(var(--icon))] disabled:bg-transparent disabled:text-[rgb(var(--icon-disabled))]",
  danger:
    "border border-transparent bg-[rgb(var(--danger))] text-[rgb(var(--on-danger))] hover:bg-[rgb(var(--danger))]/90 disabled:border-[rgb(var(--control-disabled-border))] disabled:bg-[rgb(var(--control-disabled-bg))] disabled:text-[rgb(var(--icon-disabled))]",
  link: "h-auto border-none px-0 text-foreground underline-offset-4 hover:underline disabled:text-[rgb(var(--icon-disabled))] disabled:no-underline",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-11 px-6 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "secondary",
      size = "md",
      loading = false,
      leftIcon,
      rightIcon,
      asChild = false,
      className,
      disabled,
      children,
      type = "button",
      ...props
    },
    ref,
  ): React.ReactElement {
    const classes = cn(
      "ui-button relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium [&_svg]:shrink-0",
      "transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
      "disabled:cursor-not-allowed disabled:opacity-100 disabled:active:translate-y-0",
      variant !== "link" && sizeClass[size],
      variantClass[variant],
      className,
    );

    const content = (
      <>
        {leftIcon}
        {children}
        {loading ? (
          <>
            <Spinner className="shrink-0" size="sm" />
            <span className="sr-only">处理中…</span>
          </>
        ) : (
          rightIcon
        )}
      </>
    );

    if (asChild && isValidElement(children)) {
      return cloneElement(children, {
        className: cn(
          (children.props as { className?: string }).className,
          classes,
        ),
        "aria-disabled": disabled || loading ? true : undefined,
        "aria-busy": loading || undefined,
        ...props,
      } as React.HTMLAttributes<HTMLElement>);
    }

    return (
      <button
        className={classes}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        ref={ref}
        type={type}
        {...props}
      >
        {content}
      </button>
    );
  },
);
