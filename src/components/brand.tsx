import { Workflow } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

export function Brand({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <Workflow className="size-5" aria-hidden="true" />
      </span>
      {!compact && (
        <span className="text-lg font-semibold tracking-tight">
          {APP_NAME}
          <span className="block text-xs font-normal tracking-normal text-muted-foreground">
            by NMT Solutions
          </span>
        </span>
      )}
    </span>
  );
}
