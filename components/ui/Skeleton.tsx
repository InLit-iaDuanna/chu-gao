import { cn } from "@/lib/utils";

type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

export function Skeleton({
  className,
  ...props
}: SkeletonProps): React.ReactElement {
  return (
    <div
      className={cn(
        "rounded bg-surface-2 [animation:skeletonPulse_1.2s_linear_infinite]",
        className,
      )}
      {...props}
    />
  );
}
