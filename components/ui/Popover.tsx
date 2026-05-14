"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface PopoverProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Popover({
  trigger,
  children,
  className,
}: PopoverProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return (
    <div ref={ref} className="relative inline-flex">
      <span onClick={() => setOpen((value) => !value)}>{trigger}</span>
      {open ? (
        <div
          className={cn(
            "absolute right-0 top-[calc(100%+6px)] z-50 min-w-48 rounded-md border border-border bg-surface p-2 shadow-[var(--shadow-md)]",
            className,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
