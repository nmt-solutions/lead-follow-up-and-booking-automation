import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <div
      className="app-page flex flex-col gap-6"
      role="status"
      aria-label="Loading subscription setup"
    >
      <Skeleton className="h-10 w-64 max-w-full" />
      <div className="grid gap-5 lg:grid-cols-3">
        {[1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-96 rounded-2xl" />
        ))}
      </div>
      <span className="sr-only">Loading plans</span>
    </div>
  );
}
