import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

type CheckboxProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Checkbox({
  className,
  ...props
}: CheckboxProps): React.ReactElement {
  return (
    <span className="relative inline-flex h-4 w-4 shrink-0">
      <input
        className={cn(
          "peer h-4 w-4 appearance-none rounded-sm border border-[rgb(var(--control-border))] bg-surface transition-colors checked:border-brand checked:bg-brand focus:shadow-[var(--shadow-focus)] disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        type="checkbox"
        {...props}
      />
      <Check
        className="pointer-events-none absolute left-0.5 top-0.5 hidden h-3 w-3 text-on-accent peer-checked:block"
        strokeWidth={2}
      />
    </span>
  );
}
