"use client";
import { FieldGroup } from "./ui/field";
import { openPilotCheckout } from "./razorpay-pilot-checkout";
import { openReachCheckout } from "./razorpay-reach-checkout";
import { Input } from "./ui/input";
import Link from "next/link";
import { RecoveryLink } from "./recovery-link";
import { SubscriptionLifecyclePanel } from "./subscription-lifecycle-panel";
import { openCardRecovery } from "./razorpay-recovery";
import { recoveryCheckoutSchema } from "@/models/subscription-lifecycle";
import { useRef, useState } from "react";
import { z } from "zod";
import {
  paymentActionSchema,
  paymentWorkspaceSchema,
  type PaymentAction,
  type PaymentWorkspace,
} from "@/models/subscription-payments";
import type { QuoteReview } from "@/models/subscription-quotes";
import { formatTaxMoney } from "@/models/tax";
import { readCommercialResponse } from "./subscription-quote-client";
import { SubscriptionDisclosures } from "./subscription-quote-summary";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert } from "./ui/alert";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";

const states: Record<PaymentAction["state"], string> = {
  reviewed: "Ready for checkout",
  checkout: "Checkout available · awaiting payment",
  pending: "Payment pending · reconciliation required",
  review_required: "Review required",
  confirmed: "Payment confirmed",
  failed: "Payment failed",
};
const reasons: Record<string, string> = {
  native_preflight_rejected:
    "The native plan or card availability could not be verified before creation. No subscription creation was attempted. Ask the operator to review account and plan setup, then prepare a new checkout review.",
  pilot_order_customer_and_card_path_review_required:
    "Ask the deployment operator to review this Business's exact native customer, one-time card order path and separate monthly mandate terms.",
  native_plan_or_capability_review_required:
    "The native plan, amount limit or approved card capability does not match this quote. Ask the operator to review the account and plan mapping.",
  creation_lookup_ambiguous:
    "More than one native resource matches this saved operation. The operator must reconcile the provider references. Another subscription will not be created automatically.",
  allowance_units_unavailable:
    "The included automation unit has no approved consumer. Ask the pricing operator to configure provider calls or an explicitly supported unit, then create a new quote.",
  tax_review_required:
    "Tax treatment needs operator review. Review billing evidence and tax coverage, then prepare a new checkout.",
  financial_inputs_changed:
    "Pricing, billing evidence or approved tax treatment changed. Review a current quote and prepare a new checkout.",
  creation_pending:
    "The payment operation is saved. Wait for reconciliation before starting another purchase.",
  creation_outcome_unknown:
    "The checkout result is uncertain. Refresh payment status; this operation will not be charged again automatically.",
  reconciliation_unavailable:
    "The payment provider could not confirm the result. Recovery continues independently of this page.",
  provider_outcome_unknown:
    "The provider has not established the payment outcome. Access remains unchanged.",
  provider_binding_mismatch:
    "Provider references, currency or amount need reconciliation by the operator.",
  payment_or_period_mismatch:
    "The confirmed amount or intended period needs operator review.",
  payment_or_period_already_allocated:
    "This payment or period has already been allocated. The operator must review it.",
  provider_event_conflict:
    "An authenticated confirmation event disagrees with the current provider result. Recovery continues; the operator must review the provider evidence.",
};
function paymentTime(value: string | null | undefined) {
  return value
    ? `${new Date(value).toLocaleString("en", { timeZone: "UTC" })} UTC`
    : "No confirmed paid period";
}

function PaymentDetail({ action: a }: { action: PaymentAction }) {
  const q = a.snapshot.quote,
    t = a.snapshot.tax;
  const collection = a.snapshot.collection;
  return (
    <div className="flex flex-col gap-4 wrap-anywhere">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">
          {a.snapshot.adjustment ? "Reach adjustment · " : ""}
          {q.pricing.offer.label}
        </h3>
        <Badge>
          {a.reconciliationPending
            ? "Provider event awaiting reconciliation"
            : states[a.state]}
        </Badge>
      </div>
      <p>
        {q.currency} ·{" "}
        {a.snapshot.pilotContinuation
          ? "Separately approved monthly continuation, UTC"
          : q.initial.kind === "paid_pilot"
            ? `${q.initial.days} day paid pilot`
            : a.snapshot.adjustment
              ? `Prorated reach adjustment: ${paymentTime(a.snapshot.adjustment.start)} to ${paymentTime(a.snapshot.adjustment.end)}`
              : "One calendar month, UTC"}
      </p>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-muted-foreground">Before tax</dt>
          <dd>
            {formatTaxMoney(
              t.totals?.netMinor ?? String(q.initial.subtotalMinor),
              q.currency,
            )}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Tax</dt>
          <dd>
            {t.totals
              ? formatTaxMoney(t.totals.taxMinor, q.currency)
              : "Review required"}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Total payable</dt>
          <dd className="font-semibold">
            {t.totals
              ? formatTaxMoney(t.totals.totalMinor, q.currency)
              : "Not established"}
          </dd>
        </div>
      </dl>
      {a.snapshot.adjustment ? (
        <p className="text-sm">
          This captured prorated adjustment applies to the original paid period.
          Its extra units share that period&apos;s usage; it does not create
          another monthly allowance.
        </p>
      ) : (
        <p className="text-sm">
          Discovery: {(a.snapshot.basis ?? q.initial).discovery.quantity}{" "}
          {(a.snapshot.basis ?? q.initial).discovery.unit}. Automation:{" "}
          {(a.snapshot.basis ?? q.initial).automation.quantity}{" "}
          {(a.snapshot.basis ?? q.initial).automation.unit}. Reach:{" "}
          {q.pricing.offer.markets.join(", ")}.
        </p>
      )}
      {!a.snapshot.adjustment && (
        <p className="text-sm text-muted-foreground">
          Renewal terms: {q.renewal.terms} Monthly renewal before tax:{" "}
          {formatTaxMoney(String(q.renewal.subtotalMinor), q.currency)}.{" "}
          {collection
            ? `Hosted checkout authorizes recurring ${collection.method === "upi" ? "UPI AutoPay" : "card"} collection for this plan. Each captured cycle requires independent payment and invoice reconciliation before access is extended.`
            : "This purchase authorizes the initial period."}
        </p>
      )}
      {collection && !a.snapshot.adjustment && (
        <p className="text-sm">
          Hosted mandate: up to {collection.totalCount} monthly collections on
          plan {collection.planId}. Review the hosted mandate before
          authorizing.
        </p>
      )}
      {a.snapshot.term.kind === "days" && (
        <p className="text-sm">
          This is a separate one-time pilot payment. Monthly collection needs a
          later explicit mandate approval; completing this checkout does not
          authorize that mandate.
        </p>
      )}
      {a.snapshot.pilotContinuation && (
        <p className="text-sm">
          Original pilot ends{" "}
          {paymentTime(a.snapshot.pilotContinuation.originalEnd)}. Monthly
          collection starts {paymentTime(a.snapshot.pilotContinuation.startAt)};
          authorization expires{" "}
          {paymentTime(a.snapshot.pilotContinuation.approvalExpiresAt)}. Access
          requires a verified captured monthly payment. Any interval after the
          pilot ends and before that paid monthly period is a service gap.
        </p>
      )}
      {a.reason && (
        <p className="rounded-xl bg-muted p-4">
          {reasons[a.reason] ??
            "Review this payment with the operator before retrying."}
        </p>
      )}
      {t.reasons.length > 0 && (
        <ul className="list-disc pl-5 text-sm">
          {t.reasons.map((r, i) => (
            <li key={i}>
              {r.kind}: {r.code.replaceAll("_", " ")}
            </li>
          ))}
        </ul>
      )}
      {a.state === "confirmed" && (
        <p role="status" className="text-success">
          Paid period: {paymentTime(a.observation?.periodStart)} through{" "}
          {paymentTime(a.observation?.periodEnd)}. Current access also depends
          on this period being effective.
        </p>
      )}
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-primary">
          Saved financial snapshot and provider references
        </summary>
        <pre className="max-h-96 overflow-auto rounded-xl bg-muted p-4 text-xs whitespace-pre-wrap">
          {JSON.stringify(
            {
              actionId: a.id,
              at: a.at,
              operationKey: a.operationKey,
              snapshot: a.snapshot,
              checkout: a.checkout
                ? {
                    customerId: a.checkout.customerId,
                    checkoutId: a.checkout.checkoutId,
                    subscriptionId: a.checkout.subscriptionId,
                  }
                : null,
              observation: a.observation,
              recovery: a.recovery,
              history: a.history,
              lifecycle: a.lifecycle,
              lifecycleEvents: a.lifecycleEvents,
              events: a.events,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
}

export function SubscriptionPaymentManager({
  businessId,
  initial,
  quotes,
}: {
  businessId: string;
  initial: PaymentWorkspace;
  quotes: QuoteReview[];
}) {
  const [state, setState] = useState(initial),
    [quoteId, setQuoteId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const pending = useRef(false),
    request = useRef<{ quoteId: string; key: string } | null>(null);
  const monthlyRequests = useRef(new Map<string, string>());
  const base = `/api/businesses/${businessId}/subscription-payments`;
  async function run(task: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
    } catch (e: unknown) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to confirm payment status. Refresh before retrying.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    setState(
      await readCommercialResponse(
        await fetch(base, { cache: "no-store" }),
        paymentWorkspaceSchema,
      ),
    );
  }
  async function command(kind: "start" | "refresh", actionId: string) {
    await readCommercialResponse(
      await fetch(`${base}/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionId }),
      }),
      paymentActionSchema,
    );
    await refresh();
    setMessage("Saved payment status refreshed.");
  }
  async function pilotCheckout(a: PaymentAction) {
    if (!a.checkout) return;
    await openPilotCheckout(
      a.checkout,
      (proof) => {
        void run(async () => {
          await readCommercialResponse(
            await fetch(`${base}/pilot-callback`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ actionId: a.id, ...proof }),
            }),
            paymentActionSchema,
          );
          await refresh();
          setMessage(
            "Signed checkout result checked against native capture. Review the recorded payment outcome.",
          );
        });
      },
      () =>
        setMessage(
          "Checkout closed. Refresh payment status to reconcile any capture.",
        ),
    );
  }
  async function prepareMonthly(a: PaymentAction, form: HTMLFormElement) {
    const data = new FormData(form),
      period = state.periods.find((p) => p.actionId === a.id);
    if (!period) throw new Error("A captured pilot period is required.");
    const input = {
        originalActionId: a.id,
        originalPeriodId: period.id,
        startAt: new Date(String(data.get("startAt"))).toISOString(),
        approvalExpiresAt: new Date(
          String(data.get("expiresAt")),
        ).toISOString(),
        agreeSeparateMandate: data.get("agree") === "on",
      },
      fingerprint = JSON.stringify(input),
      requestKey =
        monthlyRequests.current.get(fingerprint) ?? crypto.randomUUID();
    monthlyRequests.current.set(fingerprint, requestKey);
    await readCommercialResponse(
      await fetch(`${base}/pilot-renewal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, requestKey }),
      }),
      paymentActionSchema,
    );
    await refresh();
    monthlyRequests.current.delete(fingerprint);
    setMessage(
      "Separate monthly mandate terms saved for review. Create its checkout only after reviewing the exact monthly tax total and schedule.",
    );
  }
  async function monthlyCheckout(a: PaymentAction) {
    if (!a.checkout?.mandate) return;
    await openReachCheckout(
      { ...a.checkout.mandate, kind: "mandate" },
      () => {
        void run(async () => {
          await command("refresh", a.id);
          setMessage(
            "Monthly authorization checked against native records. Only an exact captured monthly payment validates paid renewal.",
          );
        });
      },
      () =>
        setMessage(
          "Monthly authorization closed. Refresh payment status to reconcile any result; authorization is not paid renewal.",
        ),
    );
  }
  async function lifecycleCommand(
    kind: "cancel" | "update-payment",
    actionId: string,
  ) {
    const response = await fetch(`${base}/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actionId, requestKey: crypto.randomUUID() }),
    });
    if (kind === "cancel") {
      await readCommercialResponse(response, paymentActionSchema);
      await refresh();
      setMessage(
        "Cancellation request saved. Review provider confirmation and the effective date below.",
      );
      return;
    }
    const checkout = await readCommercialResponse(
      response,
      recoveryCheckoutSchema,
    );
    await openCardRecovery(
      checkout,
      () => {
        void run(async () => {
          await command("refresh", actionId);
          setMessage(
            "Secure card flow completed. Only reconciled captures change paid access.",
          );
        });
      },
      () =>
        setMessage(
          "Secure card flow closed. Reconcile payment status to check any payment outcome.",
        ),
    );
    await refresh();
    setMessage(
      "Secure card recovery opened. Paid access still requires a confirmed capture.",
    );
  }
  return (
    <div className="flex flex-col gap-8" aria-busy={busy}>
      <div className="flex flex-wrap gap-4">
        <Link
          href={`/businesses/${businessId}/subscription-quotes`}
          className="inline-flex min-h-11 items-center text-primary underline"
        >
          Review subscription quotes
        </Link>
        <Link
          href={`/businesses/${businessId}/billing`}
          className="inline-flex min-h-11 items-center text-primary underline"
        >
          Billing evidence
        </Link>
        <RecoveryLink
          href="/security"
          className="inline-flex min-h-11 items-center text-primary underline"
        >
          Security
        </RecoveryLink>
      </div>
      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-xl font-semibold">
          {state.access.active ? "Paid access active" : "Paid access inactive"}
        </h2>
        <p>Paid through: {paymentTime(state.access.paidThrough)}.</p>
        {state.effectiveScope && (
          <p>
            Current geographic reach: {state.effectiveScope.markets.join(", ")}.
          </p>
        )}
        {state.allowances && (
          <dl className="grid gap-3 sm:grid-cols-2">
            {(["discovery", "automation"] as const).map((kind) => (
              <div key={kind}>
                <dt className="font-medium capitalize">{kind} allowance</dt>
                <dd>
                  {state.allowances![kind].remaining} of{" "}
                  {state.allowances![kind].included}{" "}
                  {state.allowances![kind].unit} remaining;{" "}
                  {state.allowances![kind].reserved} reserved or consumed.
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="text-sm text-muted-foreground">
          Returning from checkout does not confirm payment. Provider
          reconciliation continues if this page is closed. Incoming inquiries
          and stored work remain available; acquisition reach and automated
          dispatch use current paid scope and allowances.
        </p>
        <Button variant="outline" disabled={busy} onClick={() => run(refresh)}>
          {busy ? "Working…" : "Refresh saved status"}
        </Button>
      </section>
      {!state.gateway.ready && (
        <p className="rounded-xl border border-border bg-muted p-4">
          Hosted checkout is awaiting payment-provider configuration, approved
          currencies and merchant activation. Saved records remain available.
        </p>
      )}
      {state.gateway.key === "razorpay" && (
        <section
          className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 wrap-anywhere"
          aria-label="Recurring card readiness"
        >
          <h2 className="text-xl font-semibold">Recurring card readiness</h2>
          <p>
            Provider mode: {state.gateway.mode}. Card details and mandate
            authorization stay on Razorpay. eMandate is unavailable.
          </p>
          {state.gateway.reasons?.length ? (
            <ul className="list-disc pl-5">
              {state.gateway.reasons.map((r) => (
                <li key={r}>
                  {r.replaceAll("_", " ")}. Ask the platform operator to review
                  account setup.
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-sm text-muted-foreground">
            This checkout uses cards. For an eligible UPI AutoPay replacement,
            open Reach changes and request a separate reviewed agreement. A
            captured payment and matching invoice establish each paid period.
          </p>
        </section>
      )}
      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-xl font-semibold">Review tax and checkout</h2>
        <p>
          Select a saved current quote. The server calculates tax from trusted
          quote lines and current approved treatment.
        </p>
        <Label htmlFor="payment-quote">Subscription quote</Label>
        <NativeSelect
          id="payment-quote"
          value={quoteId}
          onChange={(e) => setQuoteId(e.target.value)}
        >
          <option value="">Choose a quote</option>
          {quotes.map((q) => (
            <option key={q.snapshot.id} value={q.snapshot.id}>
              {q.snapshot.pricing.offer.label} · {q.snapshot.at}
              {q.commercialReady ? "" : " · needs review"}
            </option>
          ))}
        </NativeSelect>
        <Button
          disabled={busy || !quoteId || !state.gateway.ready}
          onClick={() =>
            run(async () => {
              if (request.current?.quoteId !== quoteId)
                request.current = { quoteId, key: crypto.randomUUID() };
              await readCommercialResponse(
                await fetch(base, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    quoteId,
                    requestKey: request.current!.key,
                  }),
                }),
                paymentActionSchema,
              );
              await refresh();
              request.current = null;
              setMessage(
                "Checkout review saved. Review its tax, total and period before continuing.",
              );
            })
          }
        >
          {busy ? "Working…" : "Prepare checkout review"}
        </Button>
      </section>
      {error && (
        <Alert variant="destructive" role="alert">
          {error}
        </Alert>
      )}
      {message && (
        <p role="status" className="text-success">
          {message}
        </p>
      )}
      <SubscriptionDisclosures />
      {state.periods.length > 0 && (
        <section
          className="flex flex-col gap-4"
          aria-label="Confirmed charge periods"
        >
          <h2 className="text-xl font-semibold">Confirmed charge periods</h2>
          {state.periods.toReversed().map((p) => (
            <article
              key={p.id}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 wrap-anywhere"
            >
              <h3 className="font-semibold">
                {paymentTime(p.start)} through {paymentTime(p.end)}
              </h3>
              <p>
                {p.snapshot.adjustment
                  ? "Prorated reach adjustment"
                  : p.snapshot.basis?.kind === "renewal"
                    ? "Monthly renewal"
                    : "Initial payment"}{" "}
                ·{" "}
                {p.snapshot.tax.totals
                  ? formatTaxMoney(
                      p.snapshot.tax.totals.totalMinor,
                      p.snapshot.quote.currency,
                    )
                  : "Amount under review"}
                ; tax{" "}
                {p.snapshot.tax.totals
                  ? formatTaxMoney(
                      p.snapshot.tax.totals.taxMinor,
                      p.snapshot.quote.currency,
                    )
                  : "under review"}
                .
              </p>
              {p.charge?.charge && (
                <p className="text-sm text-muted-foreground">
                  {p.charge.charge.international ? "International" : "Domestic"}{" "}
                  captured card payment {p.paymentId}.{" "}
                  {p.charge.charge.invoiceId
                    ? `Provider invoice reference: ${p.charge.charge.invoiceId}`
                    : `Provider order reference: ${p.charge.charge.orderId}`}
                  . This reference is collection evidence; seller invoices are
                  issued separately.
                </p>
              )}
              <details>
                <summary className="min-h-11 cursor-pointer py-3 text-primary">
                  Frozen charge, tax and allowance evidence
                </summary>
                <pre className="max-h-96 overflow-auto rounded-xl bg-muted p-4 text-xs whitespace-pre-wrap">
                  {JSON.stringify(
                    { periodId: p.id, snapshot: p.snapshot, charge: p.charge },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </article>
          ))}
        </section>
      )}
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Payment history</h2>
        {!state.actions.length && (
          <p>No checkout reviews yet. Choose a quote above.</p>
        )}
        {state.actions.toReversed().map((a) => (
          <article
            key={a.id}
            className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6"
          >
            <PaymentDetail action={a} />
            {a.snapshot.term.kind === "days" && a.state === "confirmed" && (
              <details className="rounded-xl border border-border p-4">
                <summary className="min-h-11 cursor-pointer font-medium">
                  Approve a separate monthly mandate
                </summary>
                <p className="my-3">
                  The pilot is a one-time payment. Monthly continuation needs a
                  separate card mandate and explicit approval. The original
                  agreed monthly price is{" "}
                  {formatTaxMoney(
                    String(a.snapshot.quote.renewal.subtotalMinor),
                    a.snapshot.quote.currency,
                  )}{" "}
                  before current tax. Original pilot days and allowances stay
                  unchanged. Select a future start; starting after the original
                  paid end leaves a gap. Authorization alone is not paid
                  renewal.
                </p>
                <form
                  className="flex flex-col gap-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    void run(() => prepareMonthly(a, form));
                  }}
                >
                  <FieldGroup className="gap-4">
                    <Label htmlFor={`monthly-start-${a.id}`}>
                      Monthly start (your local time)
                    </Label>
                    <Input
                      id={`monthly-start-${a.id}`}
                      name="startAt"
                      type="datetime-local"
                      required
                    />
                    <Label htmlFor={`monthly-expiry-${a.id}`}>
                      Approval expiry before monthly start (your local time)
                    </Label>
                    <Input
                      id={`monthly-expiry-${a.id}`}
                      name="expiresAt"
                      type="datetime-local"
                      required
                    />
                    <label className="flex min-h-11 items-center gap-3">
                      <input
                        type="checkbox"
                        name="agree"
                        required
                        className="size-5"
                      />
                      I approve this separate mandate for the original agreed
                      monthly price and allowances at the selected start.
                    </label>
                    <Button disabled={busy}>
                      Prepare monthly mandate review
                    </Button>
                  </FieldGroup>
                </form>
              </details>
            )}
            <SubscriptionLifecyclePanel
              action={a}
              busy={busy}
              onUpdate={() =>
                run(() => lifecycleCommand("update-payment", a.id))
              }
              onCancel={() => run(() => lifecycleCommand("cancel", a.id))}
            />
            <div className="flex flex-wrap gap-3">
              {a.state === "reviewed" && (
                <Button
                  disabled={busy}
                  onClick={() => run(() => command("start", a.id))}
                >
                  {busy ? "Working…" : "Create hosted checkout"}
                </Button>
              )}
              {a.checkout?.standard && (
                <Button
                  disabled={busy}
                  onClick={() => run(() => pilotCheckout(a))}
                >
                  Pay the one-time pilot
                </Button>
              )}
              {a.checkout?.mandate && a.state === "checkout" && (
                <Button
                  disabled={busy}
                  onClick={() => run(() => monthlyCheckout(a))}
                >
                  Authorize the separate monthly mandate
                </Button>
              )}
              {a.checkout &&
                !a.checkout.standard &&
                !a.checkout.mandate &&
                a.state === "checkout" && (
                  <Button asChild>
                    <a href={a.checkout.url} rel="noreferrer">
                      Continue to secure checkout
                    </a>
                  </Button>
                )}
              {a.started &&
                [
                  "pending",
                  "checkout",
                  "failed",
                  "review_required",
                  "confirmed",
                ].includes(a.state) && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => run(() => command("refresh", a.id))}
                  >
                    {busy ? "Working…" : "Reconcile payment status"}
                  </Button>
                )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

export function SubscriptionPaymentOperator({
  initial,
}: {
  initial: PaymentAction[];
}) {
  const [actions, setActions] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  return (
    <div className="flex flex-col gap-6" aria-busy={busy}>
      <p>
        Reconciliation uses the payment provider&apos;s authoritative state. It
        cannot manually mark a payment as paid or grant access. Tax review
        requires approved rules and a new checkout review.
      </p>
      <RecoveryLink
        href="/security"
        className="inline-flex min-h-11 items-center text-primary underline"
      >
        Verify operator MFA in Security
      </RecoveryLink>
      {error && (
        <Alert role="alert" variant="destructive">
          {error}
        </Alert>
      )}
      {!actions.length && <p>No subscription payment actions yet.</p>}
      {actions.toReversed().map((a) => (
        <article
          key={a.id}
          className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6"
        >
          <h2 className="text-xl font-semibold wrap-anywhere">
            {a.snapshot.quote.profile.profile.legalName}
          </h2>
          <PaymentDetail action={a} />
          <SubscriptionLifecyclePanel action={a} />
          <div className="flex flex-wrap gap-4">
            <Link
              href={`/platform/billing/${a.businessId}`}
              className="inline-flex min-h-11 items-center text-primary underline"
            >
              Review billing evidence
            </Link>
            <Link
              href={`/platform/tax/${a.businessId}`}
              className="inline-flex min-h-11 items-center text-primary underline"
            >
              Review tax treatment
            </Link>
            <Button
              disabled={busy || !a.started}
              variant="outline"
              onClick={async () => {
                if (pending.current) return;
                pending.current = true;
                setBusy(true);
                setError("");
                try {
                  await readCommercialResponse(
                    await fetch(
                      `/api/platform/subscription-payments/${a.businessId}`,
                      {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ actionId: a.id }),
                      },
                    ),
                    paymentActionSchema,
                  );
                  setActions(
                    await readCommercialResponse(
                      await fetch("/api/platform/subscription-payments", {
                        cache: "no-store",
                      }),
                      z.array(paymentActionSchema),
                    ),
                  );
                } catch (e: unknown) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Reconciliation unavailable. Retry after reviewing saved state.",
                  );
                } finally {
                  pending.current = false;
                  setBusy(false);
                }
              }}
            >
              {busy ? "Reconciling…" : "Reconcile with provider"}
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}
