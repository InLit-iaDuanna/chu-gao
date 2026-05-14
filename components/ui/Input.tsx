import { cn } from "@/lib/utils";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  inputSize?: "sm" | "md" | "lg";
}

const sizeClass: Record<NonNullable<InputProps["inputSize"]>, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-2.5 text-sm",
  lg: "h-10 px-3 text-sm",
};

export function Input({
  inputSize = "md",
  className,
  ...props
}: InputProps): React.ReactElement {
  return (
    <input
      className={cn(
        "w-full rounded-md border border-border bg-surface text-foreground outline-none transition-colors duration-[var(--duration-fast)] ease-out placeholder:text-text-faint",
        "hover:border-border-strong focus:border-foreground focus:shadow-[var(--shadow-focus)] aria-[invalid=true]:border-danger",
        sizeClass[inputSize],
        className,
      )}
      {...props}
    />
  );
}
