export function LoadingSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[8px] bg-surface-2 ${className ?? ""}`}
    />
  );
}
