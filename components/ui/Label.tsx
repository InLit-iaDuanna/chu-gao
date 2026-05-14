import { cn } from "@/lib/utils";

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export function Label({
  className,
  required = false,
  children,
  ...props
}: LabelProps): React.ReactElement {
  return (
    <label
      className={cn("text-xs font-medium text-foreground", className)}
      {...props}
    >
      {children}
      {required ? <span className="ml-1 text-danger">*</span> : null}
    </label>
  );
}
