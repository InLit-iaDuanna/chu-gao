"use client";

import { useLayoutEffect, useRef } from "react";

import { cn } from "@/lib/utils";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoResize?: boolean;
}

export function Textarea({
  autoResize = false,
  className,
  value,
  ...props
}: TextareaProps): React.ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (!autoResize || !ref.current) {
      return;
    }

    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [autoResize, value]);

  return (
    <textarea
      ref={ref}
      className={cn(
        "min-h-20 w-full resize-none rounded-[var(--radius-md)] border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors duration-[var(--duration-fast)] ease-out placeholder:text-text-faint",
        "hover:border-border-strong focus:border-ink/60 focus:ring-2 focus:ring-brand/25 aria-[invalid=true]:border-danger",
        className,
      )}
      value={value}
      {...props}
    />
  );
}
