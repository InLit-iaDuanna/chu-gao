"use client";

import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoResize?: boolean;
  controlSize?: "sm" | "md" | "lg";
  invalid?: boolean;
}

const sizeClass: Record<NonNullable<TextareaProps["controlSize"]>, string> = {
  sm: "min-h-16 px-2.5 py-1.5 text-xs",
  md: "min-h-20 px-2.5 py-2 text-sm",
  lg: "min-h-28 px-3 py-2.5 text-sm",
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      autoResize = false,
      controlSize = "md",
      invalid = false,
      className,
      value,
      "aria-invalid": ariaInvalid,
      ...props
    },
    forwardedRef,
  ): React.ReactElement {
    const innerRef = useRef<HTMLTextAreaElement>(null);

    useImperativeHandle(
      forwardedRef,
      () => innerRef.current as HTMLTextAreaElement,
    );

    useLayoutEffect(() => {
      if (!autoResize || !innerRef.current) {
        return;
      }

      innerRef.current.style.height = "auto";
      innerRef.current.style.height = `${innerRef.current.scrollHeight}px`;
    }, [autoResize, value]);

    return (
      <textarea
        ref={innerRef}
        className={cn(
          "ui-textarea w-full resize-none rounded-md border border-[rgb(var(--control-border))] bg-[rgb(var(--control-bg))] text-foreground outline-none transition-[background-color,border-color,color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)] placeholder:text-text-muted",
          "hover:border-[rgb(var(--control-border-hover))] hover:bg-[rgb(var(--control-bg-hover))] focus:border-[rgb(var(--control-focus))] focus:shadow-[var(--shadow-focus)] aria-[invalid=true]:border-danger",
          "disabled:cursor-not-allowed disabled:border-[rgb(var(--control-disabled-border))] disabled:bg-[rgb(var(--control-disabled-bg))] disabled:text-[rgb(var(--icon-disabled))] disabled:placeholder:text-[rgb(var(--icon-disabled))]",
          sizeClass[controlSize],
          className,
        )}
        aria-invalid={invalid ? true : ariaInvalid || undefined}
        value={value}
        {...props}
      />
    );
  },
);
