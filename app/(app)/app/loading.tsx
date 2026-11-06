import { Skeleton } from "@/components/ui";

export default function AppLoading() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-3 border-b border-border px-4">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <Skeleton className="h-4 w-32" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
      </div>
      <div className="grid flex-1 gap-4 p-4 md:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid content-start gap-4 sm:grid-cols-2">
          <Skeleton className="aspect-square w-full rounded-xl" />
          <Skeleton className="aspect-square w-full rounded-xl" />
          <Skeleton className="aspect-square w-full rounded-xl max-sm:hidden" />
          <Skeleton className="aspect-square w-full rounded-xl max-sm:hidden" />
        </div>
        <div className="hidden flex-col gap-3 md:flex">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
