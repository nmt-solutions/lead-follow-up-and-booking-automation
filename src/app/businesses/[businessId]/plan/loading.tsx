import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <div
      className="app-page flex flex-col gap-6"
      role="status"
      aria-label="Loading plan and billing"
    >
      <Skeleton className="h-10 w-56" />
      <Skeleton className="h-5 w-80 max-w-full" />
      <Skeleton className="h-72 w-full rounded-2xl" />
      <span className="sr-only">Loading your subscription</span>
    </div>
  );
}
