import { cn } from "@/lib/utils";

type RadioProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Radio({ className, ...props }: RadioProps): React.ReactElement {
  return (
    <span className="relative inline-flex h-4 w-4 shrink-0">
      <input
        className={cn(
          "peer h-4 w-4 appearance-none rounded-full border border-border bg-surface transition-colors checked:border-foreground focus:shadow-[var(--shadow-focus)]",
          className,
        )}
        type="radio"
        {...props}
      />
      <span className="pointer-events-none absolute left-1 top-1 hidden h-2 w-2 rounded-full bg-foreground peer-checked:block" />
    </span>
  );
}
