"use client";
import { Button } from "@/components/ui/button";

export default function BusinessError({ reset }: { reset: () => void }) {
  return (
    <div className="flex flex-col mx-auto max-w-lg gap-5 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">
        We couldn’t load your Business.
      </h1>
      <p className="leading-relaxed text-muted-foreground">
        Please try again, or return in a few minutes.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
