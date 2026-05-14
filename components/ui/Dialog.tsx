"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

import { IconButton } from "./IconButton";

interface DialogContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DialogProps extends DialogContextValue {
  children: React.ReactNode;
}

type DialogContentProps = React.HTMLAttributes<HTMLDivElement>;

const DialogContext = createContext<DialogContextValue | null>(null);

function useDialogContext(): DialogContextValue {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error("Dialog components must be used inside Dialog.");
  }
  return context;
}

export function Dialog({
  open,
  onOpenChange,
  children,
}: DialogProps): React.ReactElement {
  return (
    <DialogContext.Provider value={{ open, onOpenChange }}>
      {children}
    </DialogContext.Provider>
  );
}

export function DialogTrigger({
  children,
}: {
  children: React.ReactElement;
}): React.ReactElement {
  const context = useDialogContext();

  return <span onClick={() => context.onOpenChange(true)}>{children}</span>;
}

export function DialogContent({
  className,
  children,
  ...props
}: DialogContentProps): React.ReactElement | null {
  const context = useDialogContext();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!context.open) {
      return;
    }

    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        context.onOpenChange(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [context]);

  if (!context.open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          context.onOpenChange(false);
        }
      }}
    >
      <div
        ref={ref}
        aria-modal="true"
        className={cn(
          "relative w-[calc(100%-32px)] max-w-[480px] rounded-lg border border-border bg-surface shadow-[var(--shadow-lg)] outline-none",
          className,
        )}
        role="dialog"
        tabIndex={-1}
        {...props}
      >
        <div className="absolute right-3 top-3">
          <IconButton
            aria-label="关闭"
            size="sm"
            onClick={() => context.onOpenChange(false)}
          >
            <X />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
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
}: React.HTMLAttributes<HTMLHeadingElement>): React.ReactElement {
  return (
    <h2
      className={cn("text-base font-semibold tracking-[-0.01em]", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>): React.ReactElement {
  return (
    <p className={cn("mt-1 text-sm text-text-muted", className)} {...props} />
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
