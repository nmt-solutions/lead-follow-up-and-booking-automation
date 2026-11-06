"use client";
import type { PaymentAction } from "@/models/subscription-payments";
import { Button, buttonVariants } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";

const time = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString() : "Not established";
const notices = {
  payment_pending:
    "Payment is pending. Access requires a confirmed captured payment.",
  payment_active:
    "A captured payment established paid access for its recorded period.",
  payment_failed:
    "A renewal is unpaid. Review the access deadline and update the card or reconcile payment.",
  access_ended:
    "Paid automation and discovery access ended. Incoming inquiries and stored work remain available.",
  payment_recovered:
    "A captured recovery payment restored access for its recorded period.",
  cancellation_requested:
    "Cancellation was requested. Provider confirmation is still required.",
  cancellation_confirmed:
    "The provider confirmed cancellation. Review its effective date and paid-through access.",
  payment_method_ready:
    "Secure card update was prepared. Preparation does not establish a changed card or payment.",
};
export function SubscriptionLifecyclePanel({
  action,
  busy,
  onCancel,
  onUpdate,
}: {
  action: PaymentAction;
  busy?: boolean;
  onCancel?: () => void;
  onUpdate?: () => void;
}) {
  const l = action.lifecycle;
  if (!l) return null;
  const policy = l.policy,
    c = l.cancellation;
  const native = action.snapshot.provider.key === "razorpay";
  const canUpdate =
    native &&
    ["active", "pending", "halted"].includes(l.provider?.status ?? "");
  const canCancel =
    native &&
    policy &&
    l.provider &&
    (policy.cancellationTiming === "immediate" ||
      (l.provider.currentEnd && new Date(l.provider.currentEnd) > new Date()));
  return (
    <section
      className="space-y-4 rounded-xl border border-border p-4 wrap-anywhere"
      aria-label="Subscription lifecycle"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-semibold">Subscription status</h3>
        <Badge>{l.state.replaceAll("_", " ")}</Badge>
        <Badge>
          {l.accessState === "grace"
            ? "Grace access"
            : l.accessState === "paid"
              ? "Paid access"
              : "Access inactive"}
        </Badge>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="font-medium">Paid through</dt>
          <dd>{time(l.paidThrough)}</dd>
        </div>
        <div>
          <dt className="font-medium">Grace ends</dt>
          <dd>{time(l.graceEnd)}</dd>
        </div>
      </dl>
      {policy ? (
        <p className="text-sm text-muted-foreground">
          Reviewed policy {policy.id}, version {policy.version}. Grace:{" "}
          {policy.graceSeconds} seconds,{" "}
          {policy.graceAccess === "remaining_allowance"
            ? "using only remaining units from the prior paid period"
            : "without access"}
          . Cancellation:{" "}
          {policy.cancellationTiming === "cycle_end"
            ? "at the provider cycle end"
            : "immediate"}
          ; access{" "}
          {policy.cancellationAccess === "paid_through"
            ? "continues through eligible captured paid periods"
            : "ends at the provider-confirmed end"}
          . Incoming and stored work is retained.
        </p>
      ) : (
        <p className="rounded-lg bg-muted p-3">
          Grace and cancellation await an effective operator-reviewed policy.
          Confirmed payment history remains available. Ask the platform operator
          to configure the subscription policy.
        </p>
      )}
      {c && (
        <p role="status">
          Cancellation{" "}
          {c.status === "requested"
            ? "requested; provider confirmation pending. Reconciliation will check its outcome without sending another cancellation."
            : `confirmed. Provider end: ${time(c.effectiveEnd)}.`}{" "}
          Request saved {time(c.requestedAt)}. A captured payment and current
          policy determine access separately.
        </p>
      )}
      {onUpdate && action.started && !c && l.state !== "cancelled" && (
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            disabled={busy || !canUpdate}
            onClick={onUpdate}
          >
            Update card or recover payment
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={busy || !canCancel}>
                Cancel subscription
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Cancel this subscription?</AlertDialogTitle>
              <AlertDialogDescription>
                The request uses the displayed reviewed policy:{" "}
                {policy?.cancellationTiming === "cycle_end"
                  ? "cancellation at the provider cycle end"
                  : "immediate cancellation"}
                . Provider confirmation is required. This does not issue a
                refund or delete incoming inquiries, conversations or stored
                work. A cancelled native subscription cannot restart.
              </AlertDialogDescription>
              <div className="flex flex-wrap justify-end gap-3">
                <AlertDialogCancel>Keep subscription</AlertDialogCancel>
                <AlertDialogAction
                  className={buttonVariants({ variant: "outline" })}
                  disabled={busy}
                  onClick={onCancel}
                >
                  Request cancellation
                </AlertDialogAction>
              </div>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
      {onUpdate && !c && (!canUpdate || !canCancel) && (
        <p className="text-sm text-muted-foreground">
          Reconcile provider status to check available actions. Card updates
          require an active, pending or halted native subscription. Cycle-end
          cancellation requires a current provider cycle; reviewed policy is
          required.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Card authorization, secure-checkout completion and active provider
        status do not grant a paid period. Only independently reconciled
        captures can do so.
      </p>
      {action.lifecycleEvents.some((e) => e.notice) && (
        <details>
          <summary className="min-h-11 cursor-pointer py-3 text-primary">
            Subscription notifications
          </summary>
          <ul className="space-y-3">
            {action.lifecycleEvents
              .filter((e) => e.notice)
              .toReversed()
              .map((e) => (
                <li key={e.id} className="rounded-lg bg-muted p-3">
                  <p>{e.notice ? notices[e.notice.kind] : ""}</p>
                  <p className="text-sm text-muted-foreground">
                    Available in app · {time(e.at)} ·{" "}
                    {e.actorId ? "Customer action" : "Payment reconciliation"}.
                    Email delivery is not established.
                  </p>
                </li>
              ))}
          </ul>
        </details>
      )}
    </section>
  );
}
