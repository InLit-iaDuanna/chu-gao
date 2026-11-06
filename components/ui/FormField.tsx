"use client";

import { cloneElement, isValidElement, useId } from "react";
import type { ReactElement } from "react";

import { cn } from "@/lib/utils";

import { Label } from "./Label";

interface FormFieldProps {
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}

export function FormField({
  label,
  description,
  error,
  required = false,
  children,
  htmlFor,
  className,
}: FormFieldProps): React.ReactElement {
  const generatedId = useId();
  const childId = isValidElement(children)
    ? (children.props as { id?: string }).id
    : undefined;
  const controlId = childId ?? htmlFor ?? `field-${generatedId}`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy =
    [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  // Associate the label, description, and error with the control for assistive tech.
  let control = children;
  if (isValidElement(children)) {
    const child = children as ReactElement<Record<string, unknown>>;
    const existingDescribedBy = child.props["aria-describedby"] as
      | string
      | undefined;
    control = cloneElement(child, {
      id: controlId,
      "aria-describedby":
        [existingDescribedBy, describedBy].filter(Boolean).join(" ") ||
        undefined,
      "aria-invalid": error ? true : child.props["aria-invalid"],
    });
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <Label htmlFor={controlId} required={required}>
          {label}
        </Label>
      ) : null}
      {control}
      {description ? (
        <p id={descriptionId} className="text-xs leading-5 text-text-muted">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
