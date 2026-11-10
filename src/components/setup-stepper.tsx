"use client";
import { Check } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

export function SetupStepper({
  steps,
  current,
  onChange,
  disabled = false,
  orientation = "horizontal",
}: {
  steps: readonly string[];
  current: number;
  onChange(step: number): void;
  disabled?: boolean;
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <nav aria-label="Setup progress">
      <ol
        className={cn(
          "flex gap-2 sm:gap-3",
          orientation === "vertical" && "lg:flex-col lg:gap-3",
        )}
      >
        {steps.map((step, index) => (
          <li key={step} className="min-w-0 flex-1">
            <Button
              variant="ghost"
              type="button"
              onClick={() => onChange(index)}
              disabled={disabled || index > current}
              aria-current={index === current ? "step" : undefined}
              className={cn(
                "flex h-auto min-h-14 w-full justify-start flex-col gap-2 rounded-lg p-1 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring sm:flex-row sm:items-center sm:gap-3",
                orientation === "vertical" && "lg:flex-row lg:p-2",
                index > current ? "text-muted-foreground" : "text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  index <= current
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-card",
                )}
              >
                {index < current ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              <span className="text-xs font-medium sm:text-sm">{step}</span>
            </Button>
            <div
              className={cn(
                "mt-2 h-1 rounded-full",
                orientation === "vertical" && "lg:hidden",
                index <= current ? "bg-primary" : "bg-border",
              )}
            />
          </li>
        ))}
      </ol>
    </nav>
  );
}
