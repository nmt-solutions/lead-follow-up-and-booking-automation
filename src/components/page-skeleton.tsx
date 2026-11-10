import { Skeleton } from "./ui/skeleton";

export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading page" className="space-y-8">
      <span className="sr-only">Loading your business...</span>
      <div aria-hidden="true" className="space-y-8">
        <div className="space-y-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-2/3 max-w-96" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="space-y-4 rounded-2xl border border-border bg-card p-6"
            >
              <Skeleton className="size-10 rounded-xl" />
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ))}
        </div>
        <div className="space-y-5 rounded-2xl border border-border bg-card p-6">
          <Skeleton className="h-6 w-40" />
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} className="h-14 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
