"use client";

import { cloneElement, isValidElement } from "react";

import { cn } from "@/lib/utils";

import { Spinner } from "./Spinner";

type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "link"
  | "brutal";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  asChild?: boolean;
  children: React.ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "border border-ink bg-ink text-background hover:border-brand hover:bg-brand hover:text-on-brand",
  secondary:
    "border border-border bg-surface text-foreground hover:border-border-strong hover:bg-surface-2",
  ghost:
    "text-text-muted border border-transparent hover:bg-ink/[0.05] hover:text-foreground",
  danger:
    "border border-danger/45 bg-transparent text-danger hover:bg-danger/10",
  link: "h-auto px-0 text-foreground hover:underline underline-offset-4 border-none",
  // Legacy "brutal" variant → 墨块按钮，hover 变信号橘（类名契约保留）
  brutal:
    "border border-ink bg-ink text-background hover:border-brand hover:bg-brand hover:text-on-brand",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export function Button({
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
}: ButtonProps): React.ReactElement {
  const isInk = variant === "brutal" || variant === "primary";

  const classes = cn(
    "inline-flex shrink-0 items-center justify-center gap-2 font-medium relative",
    // Compositor-friendly motion via CSS. Focus uses the global :focus-visible outline.
    "transition-[transform,background-color,border-color,box-shadow,color] duration-[var(--duration-fast)]",
    "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45",
    "rounded-[var(--radius-md)]",
    variant !== "link" && sizeClass[size],
    variantClass[variant],
    variant !== "link" && "active:translate-y-px motion-reduce:transform-none",
    isInk && "font-semibold",
    className,
  );

  const content = (
    <>
      {leftIcon}
      <span className="min-w-0 truncate">{children}</span>
      {loading ? (
        <>
          <Spinner size="sm" />
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
      ...props,
    } as React.HTMLAttributes<HTMLElement>);
  }

  return (
    <button
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      type={type}
      {...props}
    >
      {content}
    </button>
  );
}
