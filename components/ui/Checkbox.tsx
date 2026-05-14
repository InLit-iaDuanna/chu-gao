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
          "peer h-4 w-4 appearance-none rounded-[4px] border border-border bg-surface transition-colors checked:border-foreground checked:bg-foreground focus:shadow-[var(--shadow-focus)]",
          className,
        )}
        type="checkbox"
        {...props}
      />
      <Check
        className="pointer-events-none absolute left-0.5 top-0.5 hidden h-3 w-3 text-background peer-checked:block"
        strokeWidth={2}
      />
    </span>
  );
}
