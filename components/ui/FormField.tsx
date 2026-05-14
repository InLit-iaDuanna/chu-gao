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
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      ) : null}
      {children}
      {description ? (
        <p className="text-xs leading-5 text-text-muted">{description}</p>
      ) : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
