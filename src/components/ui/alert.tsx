import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-xl border p-4 text-sm leading-relaxed [&>svg]:mb-2 [&>svg]:size-5",
  {
    variants: {
      variant: {
        default: "border-border bg-muted text-foreground",
        destructive: "border-destructive bg-card text-destructive",
        success: "border-success/30 bg-card text-success",
        warning: "border-warning/40 bg-card text-warning",
      },
    },
    defaultVariants: { variant: "default" },
  },
);
export function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role={variant === "destructive" ? "alert" : "status"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}
export function AlertTitle({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("mb-1 font-semibold", className)}
      {...props}
    />
  );
}
export function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("text-sm leading-relaxed", className)}
      {...props}
    />
  );
}
