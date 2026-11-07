"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { z } from "zod";
import {
  reachChangeSchema,
  reachWorkspaceSchema,
  reachCheckoutSchema,
  reachUnsent,
  type ReachChange,
} from "@/models/reach-changes";
import type { QuoteReview } from "@/models/subscription-quotes";
import { formatTaxMoney } from "@/models/tax";
import { readCommercialResponse } from "./subscription-quote-client";
import { openReachCheckout } from "./razorpay-reach-checkout";
import { Button } from "./ui/button";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";

const time = (v: string) =>
  `${new Date(v).toLocaleString("en", { timeZone: "UTC" })} UTC`;
const status: Record<ReachChange["state"], string> = {
  preview: "Awaiting explicit approval",
  approved: "Approved · ready to start",
  pending: "Native outcome or payment pending",
  review_required: "Operator review required",
  applied: "Reach applied",
  withdrawn: "Unused approval withdrawn",
};
export function ReachChangeManager({
  initial,
  businessId,
  periodId = null,
  quotes = [],
  operator = false,
}: {
  initial: z.infer<typeof reachWorkspaceSchema>;
  businessId?: string;
  periodId?: string | null;
  quotes?: QuoteReview[];
  operator?: boolean;
}) {
  const [state, setState] = useState(initial),
    [quoteId, setQuoteId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const keys = useRef(new Map<string, string>());
  const key = (scope: string) => {
    let result = keys.current.get(scope);
    if (!result) {
      result = crypto.randomUUID();
      keys.current.set(scope, result);
    }
    return result;
  };
  const root = operator
    ? "/api/platform/reach-changes"
    : `/api/businesses/${businessId}/reach-changes`;
  const currentPeriod =
    state.currentPeriodId === undefined ? periodId : state.currentPeriodId;
  async function reload() {
    setState(
      await readCommercialResponse(
        await fetch(root, { cache: "no-store" }),
        reachWorkspaceSchema,
      ),
    );
  }
  async function act(run: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await run();
    } catch (error: unknown) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to confirm the saved result. Refresh before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function command(
    change: ReachChange,
    action: "approve" | "execute" | "refresh" | "withdraw",
  ) {
    const url = operator
      ? `${root}/${change.businessId}/${action}`
      : `${root}/${action}`;
    const result = await readCommercialResponse(
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          changeId: change.id,
          requestKey: key(`${change.id}:${action}`),
          ...(action === "approve"
            ? { accept: true, reviewHash: change.reviewHash }
            : {}),
        }),
      }),
      reachChangeSchema,
    );
    if (action === "approve") await command(result, "execute");
    await reload();
    setMessage(
      action === "withdraw"
        ? "The unused approval was withdrawn. Create a fresh exact preview; the old request remains in history."
        : action === "refresh"
          ? "Saved native evidence refreshed. Access still requires the matching captured payment."
          : "The approved change is saved. Review its payment and mandate status below.",
    );
  }
  async function checkout(change: ReachChange, purpose: "mandate" | "delta") {
    const result = await readCommercialResponse(
      await fetch(`${root}/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          changeId: change.id,
          requestKey: key(`${change.id}:checkout:${purpose}`),
          purpose,
        }),
      }),
      reachCheckoutSchema,
    );
    await openReachCheckout(
      result,
      () => {
        void act(() => command(change, "refresh"));
      },
      () =>
        setMessage(
          "Secure checkout closed. Refresh to reconcile any completed payment; browser callbacks do not grant reach.",
        ),
    );
  }
  return (
    <div className="space-y-6" aria-busy={busy}>
      {error && (
        <Alert role="alert">
          {error}{" "}
          <Link href="/security" className="underline">
            Open Security
          </Link>
        </Alert>
      )}
      {message && (
        <p role="status" className="rounded-lg bg-muted p-4">
          {message}
        </p>
      )}
      {!operator && (
        <section className="space-y-4 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-xl font-semibold">Preview a reach change</h2>
          {state.configuration && !state.configuration.ready && (
            <p className="rounded-lg bg-muted p-4">
              An operator must configure effective reach/proration and
              campaign-disposition terms, a reviewed card account and matching
              target plans.{" "}
              {state.configuration.reasons
                .map((r) => r.replaceAll("_", " "))
                .join("; ")}
              .
            </p>
          )}
          {!currentPeriod ? (
            <p>
              An active confirmed paid period is required. Review Subscription
              payments first.
            </p>
          ) : (
            <>
              <p>
                Choose a current monthly quote from{" "}
                <Link
                  href={`/businesses/${businessId}/subscription-quotes`}
                  className="text-primary underline"
                >
                  Subscription quotes
                </Link>
                .
              </p>
              <Label htmlFor="reach-quote">Target monthly quote</Label>
              <NativeSelect
                id="reach-quote"
                value={quoteId}
                onChange={(e) => setQuoteId(e.target.value)}
              >
                <option value="">Choose a quote</option>
                {quotes
                  .filter(
                    (q) =>
                      q.commercialReady &&
                      q.snapshot.selection.term === "monthly",
                  )
                  .map((q) => (
                    <option key={q.snapshot.id} value={q.snapshot.id}>
                      {q.snapshot.pricing.offer.label} ·{" "}
                      {formatTaxMoney(
                        String(q.snapshot.renewal.subtotalMinor),
                        q.snapshot.currency,
                      )}{" "}
                      monthly before tax
                    </option>
                  ))}
              </NativeSelect>
              <Button
                disabled={
                  busy || !quoteId || state.configuration?.ready === false
                }
                onClick={() =>
                  void act(async () => {
                    await readCommercialResponse(
                      await fetch(root, {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          periodId: currentPeriod,
                          quoteId,
                          requestKey: key(
                            `preview:${currentPeriod}:${quoteId}`,
                          ),
                        }),
                      }),
                      reachChangeSchema,
                    );
                    keys.current.delete(`preview:${currentPeriod}:${quoteId}`);
                    await reload();
                    setMessage(
                      "Preview saved. Review its exact scope, charge and renewal terms before approving.",
                    );
                  })
                }
              >
                Preview exact change
              </Button>
            </>
          )}
        </section>
      )}
      {!state.changes.length && (
        <p className="rounded-xl border border-border p-6">
          No reach changes have been requested.
        </p>
      )}
      {state.changes.map((c) => {
        const s = c.snapshot,
          t = s.delta.tax.totals!,
          native = c.events.filter((e) => e.fact.native).at(-1)?.fact.native,
          approved =
            c.state !== "withdrawn" &&
            c.events.some((e) => e.fact.kind === "approved"),
          captured = c.events.some((e) => e.fact.kind === "capture");
        return (
          <section
            key={c.id}
            className="space-y-4 rounded-2xl border border-border bg-card p-6 wrap-anywhere"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-xl font-semibold">
                {s.target.quote.pricing.offer.label}
              </h2>
              <Badge>{status[c.state]}</Badge>
            </div>
            {operator && <p>Business {c.businessId}</p>}
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-muted-foreground">
                  Prorated amount before tax
                </dt>
                <dd>{formatTaxMoney(t.netMinor, s.delta.quote.currency)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Tax</dt>
                <dd>{formatTaxMoney(t.taxMinor, s.delta.quote.currency)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">
                  Total due for this change
                </dt>
                <dd className="text-lg font-semibold">
                  {formatTaxMoney(t.totalMinor, s.delta.quote.currency)}
                </dd>
              </div>
            </dl>
            <p>
              {s.direction === "expansion"
                ? `Expansion starts after its exact confirmed captured payment, for the remaining period ending ${time(s.renewalAt)}.`
                : `Reduction starts with an eligible captured renewal at or after ${time(s.renewalAt)}. No immediate reduction or automatic refund.`}
            </p>
            <p>
              Changed reach: {s.scope.markets.join(", ")}. Included discovery:{" "}
              {s.scope.discovery.quantity} {s.scope.discovery.unit}; automation:{" "}
              {s.scope.automation.quantity} {s.scope.automation.unit}.
              Previously consumed units remain consumed. At this preview:{" "}
              {s.consumed.discovery} discovery units and {s.consumed.automation}{" "}
              automation units already reserved or consumed.
            </p>
            <p className="rounded-lg bg-muted p-4">
              Monthly renewal:{" "}
              {formatTaxMoney(
                s.target.tax.totals!.totalMinor,
                s.target.quote.currency,
              )}
              , including{" "}
              {formatTaxMoney(
                s.target.tax.totals!.taxMinor,
                s.target.quote.currency,
              )}{" "}
              tax. {s.target.quote.renewal.terms}{" "}
              {s.renewalScope.discovery.quantity}{" "}
              {s.renewalScope.discovery.unit};{" "}
              {s.renewalScope.automation.quantity}{" "}
              {s.renewalScope.automation.unit}.{" "}
              {s.path === "replacement_mandate"
                ? `The old renewal stops before a new mandate is created for ${time(s.renewalAt)}; authentication alone does not pay for expanded reach.`
                : `The reviewed international card update retains ${native?.remainingCount ?? "the reviewed remaining"} collection cycles.`}
            </p>
            <p className="text-sm">
              Proration version {s.version}:{" "}
              {s.proration.basis.replaceAll("_", " ")}, half-up rounding;
              approved policy {s.policy.id} v{s.policy.version}. Preview
              approval expires {time(c.expiresAt)}. Unengaged campaigns outside
              the new reach pause. Historical evidence and incoming or engaged
              work are retained. Reach alone does not grant sending permission.
            </p>
            <p role="status">
              Captured delta: {captured ? "Confirmed" : "Not confirmed"}.{" "}
              {s.path === "replacement_mandate"
                ? `Old renewal stopped: ${native?.oldStopped ? "confirmed" : "not confirmed"}. New mandate: ${native?.mandateReady ? "authenticated" : "not authenticated"}.`
                : `Native target: ${native?.updated ? "acknowledged; payment is checked separately" : "not yet acknowledged"}.`}
            </p>
            <div className="flex flex-wrap gap-3">
              {!operator && approved && reachUnsent(c) && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void act(() => command(c, "withdraw"))}
                >
                  Withdraw unused approval
                </Button>
              )}
              {!operator && !approved && c.state !== "withdrawn" && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button disabled={busy || !c.reviewHash}>
                      Review approval
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogTitle>
                      Approve this exact reach change?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Approve{" "}
                      {formatTaxMoney(t.totalMinor, s.delta.quote.currency)} for
                      the change and{" "}
                      {formatTaxMoney(
                        s.target.tax.totals!.totalMinor,
                        s.target.quote.currency,
                      )}{" "}
                      for each reviewed monthly renewal.{" "}
                      {s.path === "replacement_mandate"
                        ? "The existing renewal is stopped before creating a replacement mandate; this may leave a payment gap until you complete authentication."
                        : "The saved native plan change may charge the approved prorated difference."}{" "}
                      Access changes only after the corresponding payment.
                      Unengaged campaigns outside reduced reach pause.
                    </AlertDialogDescription>
                    <div className="flex flex-wrap justify-end gap-3">
                      <AlertDialogCancel>Keep current reach</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => void act(() => command(c, "approve"))}
                      >
                        Approve exact terms
                      </AlertDialogAction>
                    </div>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              {approved && c.state !== "applied" && (
                <Button
                  disabled={busy}
                  onClick={() => void act(() => command(c, "execute"))}
                >
                  Continue approved change
                </Button>
              )}
              {approved && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void act(() => command(c, "refresh"))}
                >
                  Reconcile saved change
                </Button>
              )}
              {!operator &&
                approved &&
                s.path === "replacement_mandate" &&
                native?.subscriptionId &&
                !native.mandateReady && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void act(() => checkout(c, "mandate"))}
                  >
                    Authorize replacement card mandate
                  </Button>
                )}
              {!operator && approved && native?.orderId && !captured && (
                <Button
                  disabled={busy}
                  onClick={() => void act(() => checkout(c, "delta"))}
                >
                  Pay exact prorated amount
                </Button>
              )}
              <Link
                href={`/businesses/${c.businessId}/seller-documents`}
                className="inline-flex min-h-11 items-center text-primary underline"
              >
                Invoices and credit notes
              </Link>
            </div>
            <details>
              <summary className="min-h-11 cursor-pointer py-3">
                Frozen calculation and history
              </summary>
              <p>
                Financial source: {s.original.id}. Native plan:{" "}
                {native?.planId ?? "Review required"}. Exact time fraction:{" "}
                {s.proration.numerator}/{s.proration.denominator}. Request
                actor: {c.actorId}.
              </p>
              <ul className="mt-3 space-y-2">
                {c.events.map((e) => (
                  <li key={e.id}>
                    {time(e.at)} · {e.fact.kind.replaceAll("_", " ")}
                    {e.fact.stage
                      ? ` · ${e.fact.stage.replaceAll("_", " ")}`
                      : ""}
                    {e.fact.reason
                      ? ` · ${e.fact.reason.replaceAll("_", " ")}`
                      : ""}
                  </li>
                ))}
              </ul>
            </details>
          </section>
        );
      })}
    </div>
  );
}
