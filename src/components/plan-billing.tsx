"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw } from "lucide-react";
import {
  paymentWorkspaceSchema,
  paymentActionSchema,
  type PaymentWorkspace,
} from "@/models/subscription-payments";
import { readCommercialResponse } from "./subscription-quote-client";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Alert, AlertDescription } from "./ui/alert";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "./ui/alert-dialog";

export function PlanBilling({
  businessId,
  initial,
}: {
  businessId: string;
  initial: PaymentWorkspace;
}) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pending = useRef(false);
  const cancellationKey = useRef(crypto.randomUUID());
  const activeId = state.access.period?.actionId;
  const action =
    state.actions.find((value) => value.id === activeId) ??
    [...state.actions]
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .find((value) => value.started && value.state !== "failed");
  const base = `/api/businesses/${businessId}/subscription-payments`;
  async function refresh() {
    if (action)
      await readCommercialResponse(
        await fetch(`${base}/refresh`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ actionId: action.id }),
        }),
        paymentActionSchema,
      );
    setState(
      await readCommercialResponse(
        await fetch(base, { cache: "no-store" }),
        paymentWorkspaceSchema,
      ),
    );
  }
  async function run(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e: unknown) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to confirm the result. Refresh payment status.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const date = (value?: string | null) =>
    value
      ? new Date(value).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        })
      : "Awaiting confirmation";
  const cancellation = action?.lifecycle?.cancellation;
  const cancelled =
    cancellation?.status === "confirmed" ||
    ["cancelled", "completed", "expired"].includes(
      action?.lifecycle?.provider?.status ?? "",
    );
  return (
    <div className="flex flex-col gap-6" aria-busy={busy}>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <Card>
        <CardContent className="flex flex-col gap-6 p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <h2 className="font-display text-2xl">
                {action?.snapshot.quote.pricing.offer.label ??
                  "Choose your plan"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {state.access.active
                  ? cancelled
                    ? "Cancelled · access remains until the paid period ends"
                    : "Subscription active"
                  : action
                    ? "Payment needs confirmation"
                    : "Set up now, subscribe when you’re ready."}
              </p>
            </div>
            {!action && (
              <Button asChild>
                <Link href={`/businesses/${businessId}/subscribe`}>
                  Compare plans
                </Link>
              </Button>
            )}
          </div>
          {action && (
            <>
              <dl className="grid gap-5 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Paid through (UTC)</dt>
                  <dd className="mt-1 font-medium">
                    {date(state.access.paidThrough)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Renewal</dt>
                  <dd className="mt-1 font-medium">
                    {cancelled ? "Stopped" : "Monthly, until cancelled"}
                  </dd>
                </div>
              </dl>
              {state.allowances && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    ["Discovery credits", state.allowances.discovery],
                    ["Outreach actions", state.allowances.automation],
                  ].map(
                    ([label, value]) =>
                      typeof value !== "string" && (
                        <div
                          className="rounded-xl border border-border p-5"
                          key={String(label)}
                        >
                          <p className="text-sm text-muted-foreground">
                            {String(label)} remaining
                          </p>
                          <p className="mt-2 font-display text-2xl">
                            {value.remaining.toLocaleString("en-IN")}
                            <span className="ml-2 text-sm text-muted-foreground">
                              of {value.included.toLocaleString("en-IN")}
                            </span>
                          </p>
                        </div>
                      ),
                  )}
                </div>
              )}
              {cancellation && (
                <p className="text-sm leading-7 text-muted-foreground">
                  {cancelled
                    ? "Cancellation confirmed."
                    : "Cancellation request saved. Provider confirmation may still be pending."}{" "}
                  Check the effective date in payment history before assuming
                  renewal has stopped.
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                {action.checkout?.url && !state.access.active && (
                  <Button asChild>
                    <a href={action.checkout.url} rel="noreferrer">
                      Continue checkout
                    </a>
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await refresh();
                      setMessage("Payment status updated.");
                    })
                  }
                >
                  {busy ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <RefreshCw className="size-4" aria-hidden="true" />
                  )}
                  Refresh payment status
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/businesses/${businessId}/seller-documents`}>
                    Invoices
                  </Link>
                </Button>
                {!cancelled && action.snapshot.provider.key === "razorpay" && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" disabled={busy}>
                        Cancel subscription
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogTitle>Stop future renewals?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Your paid access continues through the current paid
                        period. Cancellation stops future renewals once Razorpay
                        confirms it. It does not refund a paid period.
                      </AlertDialogDescription>
                      <div className="flex justify-end gap-3">
                        <AlertDialogCancel>Keep subscription</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() =>
                            void run(async () => {
                              await readCommercialResponse(
                                await fetch(`${base}/cancel`, {
                                  method: "POST",
                                  headers: {
                                    "content-type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    actionId: action.id,
                                    requestKey: cancellationKey.current,
                                  }),
                                }),
                                paymentActionSchema,
                              );
                              await refresh();
                              setMessage(
                                "Cancellation requested. Check the confirmed status above.",
                              );
                            })
                          }
                        >
                          Confirm cancellation
                        </AlertDialogAction>
                      </div>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link
          className="inline-flex min-h-11 items-center text-primary underline"
          href={`/businesses/${businessId}/subscription-payments`}
        >
          Payment history and card settings
        </Link>
        <Link
          className="inline-flex min-h-11 items-center text-primary underline"
          href={`/businesses/${businessId}/billing`}
        >
          Billing details
        </Link>
        <Link
          className="inline-flex min-h-11 items-center text-primary underline"
          href="/contact"
        >
          Payment help
        </Link>
      </div>
      <p className="text-xs leading-6 text-muted-foreground">
        Your team shares the business allowance. Unused allowance expires at
        period end. No automatic overage charges.{" "}
        <Link className="underline" href="/cancellation-policy">
          Cancellation policy
        </Link>{" "}
        ·{" "}
        <Link className="underline" href="/refund-policy">
          Refund policy
        </Link>
      </p>
    </div>
  );
}
