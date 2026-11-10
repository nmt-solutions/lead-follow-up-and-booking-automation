import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <div
      className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-5 py-12"
      role="status"
      aria-label="Loading setup"
    >
      <Skeleton className="mx-auto h-40 w-72" />
      <Skeleton className="h-9 w-3/4" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-12 w-full" />
      <span className="sr-only">Loading setup…</span>
    </div>
  );
}
