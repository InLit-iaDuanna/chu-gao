import { cloneElement, isValidElement } from "react";

import { cn } from "@/lib/utils";

type IconButtonVariant = "secondary" | "ghost" | "danger";
type IconButtonSize = "sm" | "md" | "lg";

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  children: React.ReactElement;
  asChild?: boolean;
}

const variantClass: Record<IconButtonVariant, string> = {
  secondary:
    "bg-surface-2 text-foreground shadow-[inset_0_0_0_1px_rgb(var(--border))] hover:bg-surface-3",
  ghost: "text-text-muted hover:bg-surface-2 hover:text-foreground",
  danger: "text-danger hover:bg-danger/10",
};

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

export function IconButton({
  variant = "ghost",
  size = "md",
  className,
  children,
  asChild = false,
  type = "button",
  ...props
}: IconButtonProps): React.ReactElement {
  const classes = cn(
    "inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-[var(--duration-fast)] ease-out",
    "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45",
    sizeClass[size],
    variantClass[variant],
    className,
  );

  if (asChild && isValidElement(children)) {
    return cloneElement(children, {
      className: cn(
        (children.props as { className?: string }).className,
        classes,
      ),
      ...props,
    } as React.HTMLAttributes<HTMLElement>);
  }

  const icon = isValidElement(children)
    ? cloneElement(children, {
        size: iconSize[size],
        strokeWidth: 1.6,
        "aria-hidden": true,
      } as React.SVGProps<SVGSVGElement>)
    : children;

  return (
    <button className={classes} type={type} {...props}>
      {icon}
    </button>
  );
}
