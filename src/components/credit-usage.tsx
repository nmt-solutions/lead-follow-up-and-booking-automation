"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  creditPercentage,
  creditUsageSchema,
  type CreditUsage,
} from "@/models/credit-usage";
import { readCommercialResponse } from "./subscription-quote-client";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { Skeleton } from "./ui/skeleton";

export function CreditUsageBars({
  usage,
  compact = false,
}: {
  usage: CreditUsage;
  compact?: boolean;
}) {
  if (!usage.active || !usage.allowances)
    return (
      <p className="text-sm text-muted-foreground">
        No active credit allowance. Check your plan or payment status.
      </p>
    );
  return (
    <div
      className={compact ? "flex flex-col gap-4" : "grid gap-6 sm:grid-cols-2"}
    >
      {(
        [
          ["Search credits", usage.allowances.discovery],
          ["Outreach actions", usage.allowances.automation],
        ] as const
      ).map(([label, pool]) => {
        const percentage = creditPercentage(pool);
        return (
          <div key={label} className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
              <span className="font-medium">{label}</span>
              <span className="text-muted-foreground">
                {percentage === null
                  ? "No included credits"
                  : `${percentage}% used / ${100 - percentage}% remaining`}
              </span>
            </div>
            {percentage !== null && (
              <Progress
                value={percentage}
                aria-label={`${label} used or reserved`}
                aria-valuetext={`${pool.reserved.toLocaleString()} used or reserved of ${pool.included.toLocaleString()}`}
              />
            )}
            <p className="text-xs leading-5 text-muted-foreground">
              {pool.remaining.toLocaleString()} remaining of{" "}
              {pool.included.toLocaleString()}
              {!compact && (
                <span className="block">
                  {pool.reserved.toLocaleString()} used or reserved for work
                  already started
                </span>
              )}
            </p>
          </div>
        );
      })}
      {!compact && (
        <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
          Usage includes work already started, including work awaiting
          confirmation. Credits belong to this business and are shared by its
          team.
        </p>
      )}
    </div>
  );
}

/** Fetch only the selected business. Clear stale data before a business switch. */
export function SidebarCreditUsage({
  businessId,
  canManagePlan,
}: {
  businessId: string;
  canManagePlan: boolean;
}) {
  const [result, setResult] = useState<{
    businessId: string;
    usage: CreditUsage;
  } | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    fetch(`/api/businesses/${businessId}/credit-usage`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => readCommercialResponse(response, creditUsageSchema))
      .then((usage) => {
        if (current) {
          setError(false);
          setResult({ businessId, usage });
        }
      })
      .catch(() => {
        if (current) {
          setResult(null);
          setError(true);
        }
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [businessId, revision]);
  const usage = result?.businessId === businessId ? result.usage : null;
  return (
    <section
      aria-label="Business credit usage"
      aria-busy={!usage && !error}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3"
    >
      <div className="flex items-center justify-between gap-2">
        {canManagePlan ? (
          <Link
            href={`/businesses/${businessId}/plan`}
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            Plan and usage
          </Link>
        ) : (
          <h2 className="text-sm font-medium">Business credits</h2>
        )}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Refresh credits"
          onClick={() => {
            setError(false);
            setResult(null);
            setRevision((value) => value + 1);
          }}
        >
          <RefreshCw aria-hidden="true" />
        </Button>
      </div>
      {error ? (
        <p role="status" className="text-xs leading-5 text-muted-foreground">
          Credits could not be checked.{" "}
          {canManagePlan
            ? "Refresh or open Plan and usage."
            : "Refresh or ask the business owner to check."}
        </p>
      ) : usage ? (
        <CreditUsageBars usage={usage} compact />
      ) : (
        <div role="status" className="flex flex-col gap-3">
          <span className="sr-only">Checking credits</span>
          {["search", "outreach"].map((pool) => (
            <div key={pool} aria-hidden="true" className="flex flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      )}
      {usage?.active && (
        <p className="text-xs leading-5 text-muted-foreground">
          Includes work already started.{" "}
          {usage.paidThrough && (
            <>
              Allowance ends{" "}
              {new Date(usage.paidThrough).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: "UTC",
              })}{" "}
              UTC.
            </>
          )}
        </p>
      )}
    </section>
  );
}
