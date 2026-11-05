import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function NativeSelect({
  className,
  ...props
}: ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "min-h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 py-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
