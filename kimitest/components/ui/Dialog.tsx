"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

/**
 * Accessible modal built on Radix Dialog — focus trap, scroll lock, Esc-to-close,
 * focus restore, and aria-labelledby/describedby (wired automatically from
 * DialogTitle/DialogDescription) all come for free.
 */
export function Dialog({
  open,
  onOpenChange,
  children,
}: DialogProps): React.ReactElement {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </RadixDialog.Root>
  );
}

export function DialogTrigger({
  children,
}: {
  children: React.ReactElement;
}): React.ReactElement {
  return <RadixDialog.Trigger asChild>{children}</RadixDialog.Trigger>;
}

interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Hide the built-in close button (e.g. when the content renders its own). */
  hideClose?: boolean;
}

export function DialogContent({
  className,
  children,
  hideClose = false,
  ...props
}: DialogContentProps): React.ReactElement {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <RadixDialog.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-xl)] border border-border bg-surface shadow-[var(--shadow-lg)] outline-none",
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <RadixDialog.Close
            aria-label="关闭"
            className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <X size={14} aria-hidden="true" />
          </RadixDialog.Close>
        )}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn("px-5 pb-3 pt-5", className)} {...props} />;
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixDialog.Title>): React.ReactElement {
  return (
    <RadixDialog.Title
      className={cn("text-base font-semibold tracking-[-0.01em]", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<
  typeof RadixDialog.Description
>): React.ReactElement {
  return (
    <RadixDialog.Description
      className={cn("mt-1 text-sm text-text-muted", className)}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 border-t border-border px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}
