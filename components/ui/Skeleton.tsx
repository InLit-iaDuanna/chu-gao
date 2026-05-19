import { cn } from "@/lib/utils";

type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

export function Skeleton({
  className,
  ...props
}: SkeletonProps): React.ReactElement {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded bg-surface-2",
        "before:absolute before:inset-0 before:-translate-x-full",
        "before:bg-[linear-gradient(90deg,transparent,rgb(var(--text)/0.04),transparent)]",
        "before:[animation:skeletonShimmer_1.6s_ease-in-out_infinite]",
        "before:bg-[length:200%_100%]",
        className,
      )}
      {...props}
    />
  );
}
