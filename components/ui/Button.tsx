import { cloneElement, isValidElement } from "react";

import { cn } from "@/lib/utils";

import { Spinner } from "./Spinner";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
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
    "bg-foreground text-background hover:bg-foreground/90 active:bg-foreground/80",
  secondary:
    "bg-surface-2 text-foreground shadow-[inset_0_0_0_1px_rgb(var(--border))] hover:bg-surface-3",
  ghost: "text-text-muted hover:bg-surface-2 hover:text-foreground",
  danger: "bg-danger text-white hover:opacity-90 active:opacity-80",
  link: "h-auto px-0 text-foreground hover:underline underline-offset-4",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-3 text-sm",
  lg: "h-10 px-4 text-sm",
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
  const classes = cn(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium transition-colors duration-[var(--duration-fast)] ease-out",
    "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45",
    variant !== "link" && sizeClass[size],
    variantClass[variant],
    className,
  );

  const content = (
    <>
      {leftIcon}
      <span className="min-w-0 truncate">{children}</span>
      {loading ? <Spinner size="sm" /> : rightIcon}
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
      type={type}
      {...props}
    >
      {content}
    </button>
  );
}
