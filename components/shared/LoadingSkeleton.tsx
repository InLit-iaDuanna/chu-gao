import { Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";

export function LoadingSkeleton({
  className,
}: {
  className?: string;
}): React.ReactElement {
  return <Skeleton className={cn("h-24", className)} />;
}

export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          className={cn("h-3", index === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({
  className,
}: {
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface p-5",
        className,
      )}
    >
      <Skeleton className="h-4 w-1/3" />
      <SkeletonText className="mt-4" lines={3} />
    </div>
  );
}

export function SkeletonRow({
  className,
}: {
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn("flex h-11 items-center gap-3", className)}>
      <Skeleton className="h-7 w-7 rounded-full" />
      <Skeleton className="h-3 flex-1" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}
