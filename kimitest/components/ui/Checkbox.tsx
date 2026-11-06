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
          "peer h-4 w-4 appearance-none rounded-[3px] border border-border-strong bg-surface transition-colors checked:border-ink checked:bg-ink focus:shadow-[var(--shadow-focus)]",
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
