import * as React from "react";
import { cn } from "@/lib/utils";
export function Badge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium",
        className,
      )}
      {...props}
    />
  );
}
