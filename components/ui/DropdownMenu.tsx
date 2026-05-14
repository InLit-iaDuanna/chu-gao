"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { Kbd } from "./Kbd";

interface DropdownMenuProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

interface DropdownMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  shortcut?: string;
}

export function DropdownMenu({
  trigger,
  children,
  className,
}: DropdownMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  function onMenuClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (target instanceof Element && target.closest('[role="menuitem"]')) {
      setOpen(false);
    }
  }

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div ref={ref} className="relative inline-flex">
      <span onClick={() => setOpen((value) => !value)}>{trigger}</span>
      {open ? (
        <div
          className={cn(
            "absolute right-0 top-[calc(100%+6px)] z-50 min-w-48 rounded-md border border-border bg-surface p-1 shadow-[var(--shadow-md)]",
            "animate-in fade-in duration-[var(--duration-base)]",
            className,
          )}
          onClick={onMenuClick}
          role="menu"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function DropdownMenuItem({
  className,
  children,
  shortcut,
  type = "button",
  ...props
}: DropdownMenuItemProps): React.ReactElement {
  return (
    <button
      className={cn(
        "flex h-8 w-full items-center justify-between gap-6 rounded-[4px] px-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-2 disabled:opacity-45",
        className,
      )}
      role="menuitem"
      type={type}
      {...props}
    >
      <span className="flex min-w-0 items-center gap-2 truncate">
        {children}
      </span>
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </button>
  );
}

export function DropdownMenuSeparator(): React.ReactElement {
  return <div className="my-1 h-px bg-border" role="separator" />;
}
