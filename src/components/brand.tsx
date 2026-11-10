import Image from "next/image";
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
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-white p-1.5">
        <Image
          src="/brand/nmt-logo.svg"
          width={32}
          height={32}
          alt=""
          unoptimized
        />
      </span>
      {!compact && (
        <span className="flex flex-col gap-0.5 font-brand text-lg font-semibold tracking-tight">
          {APP_NAME}
          <span className="block text-[0.65rem] font-medium tracking-normal text-muted-foreground">
            by NMT Solutions
          </span>
        </span>
      )}
    </span>
  );
}
