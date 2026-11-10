"use client";
import { Field, FieldGroup } from "./ui/field";
import Link from "next/link";
import { RecoveryLink } from "./recovery-link";
import { useRef, useState } from "react";
import {
  quoteReviewSchema,
  subscriptionQuoteWorkspaceSchema,
  selectionIssues,
  type SubscriptionQuoteWorkspace,
  type QuoteRequest,
} from "@/models/subscription-quotes";
import { readCommercialResponse } from "./subscription-quote-client";
import {
  SubscriptionQuoteSummary,
  SubscriptionDisclosures,
  OfferScope,
  QuoteIssues,
  quoteMoney,
} from "./subscription-quote-summary";
import { BillingStatus } from "./billing-summary";
import { NativeSelect } from "./ui/native-select";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { Alert } from "./ui/alert";

export function SubscriptionQuoteManager({
  businessId,
  initial,
}: {
  businessId: string;
  initial: SubscriptionQuoteWorkspace;
}) {
  const [state, setState] = useState(initial);
  const [offerId, setOfferId] = useState("");
  const [reservedId, setReservedId] = useState("");
  const [term, setTerm] = useState<QuoteRequest["term"]>("monthly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  const retry = useRef<{ input: string; key: string } | null>(null);
  const base = `/api/businesses/${businessId}/subscription-quotes`;
  const offer = state.offers.find((item) => item.id === offerId);
  const issues = [
    ...state.issues,
    ...selectionIssues(offer, state.currency, term, reservedId || null),
  ];
  const price = state.currency ? offer?.prices[state.currency] : null;
  async function act(operation: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await operation();
    } catch (error: unknown) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to complete this action. Retry after reviewing the saved state.",
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
        subscriptionQuoteWorkspaceSchema,
      ),
    );
  }
  return (
    <div className="flex flex-col gap-8">
      <BillingStatus state={state.billing} />
      <div className="flex flex-wrap gap-4">
        <Link
          href={`/businesses/${businessId}/subscription-payments`}
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Review tax and hosted checkout
        </Link>
        <Link
          href={`/businesses/${businessId}/billing`}
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Edit billing profile and evidence
        </Link>
        <RecoveryLink
          href="/security"
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Security
        </RecoveryLink>
      </div>
      <SubscriptionDisclosures />
      <section
        className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 sm:p-8"
        aria-labelledby="select-quote"
      >
        <h2 id="select-quote" className="text-xl font-semibold">
          Select subscription scope
        </h2>
        <p>
          Billing currency: {state.currency ?? "Not determined"}. Effective
          price version: {state.catalogVersion || "Not configured"}. Currency
          follows reviewed billing details, independently of discovery
          geography.
        </p>
        {!state.offers.length && (
          <p>
            No reach offers are currently configured. Ask the platform operator
            to configure commercial terms.
          </p>
        )}
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              const selection = {
                expectedCatalogVersion: state.catalogVersion,
                expectedBillingVersion: state.billing.version,
                expectedReviewVersion: state.billing.reviewVersion,
                offerId,
                reservedCapacityId: reservedId || null,
                term,
              };
              const input = JSON.stringify(selection);
              if (retry.current?.input !== input)
                retry.current = { input, key: crypto.randomUUID() };
              const review = await readCommercialResponse(
                await fetch(base, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    ...selection,
                    requestKey: retry.current.key,
                  }),
                }),
                quoteReviewSchema,
              );
              setState((current) => ({
                ...current,
                quotes: [
                  ...current.quotes.filter(
                    (q) => q.snapshot.id !== review.snapshot.id,
                  ),
                  review,
                ],
              }));
              retry.current = null;
              setMessage(
                "Quote saved for review. No payment or subscription change has been made.",
              );
            });
          }}
        >
          <FieldGroup className="gap-5">
            <Field className="flex flex-col gap-2">
              <Label htmlFor="quote-offer">Discovery reach offer</Label>
              <NativeSelect
                id="quote-offer"
                value={offerId}
                onChange={(event) => {
                  setOfferId(event.target.value);
                  setReservedId("");
                }}
              >
                <option value="">Select configured reach</option>
                {state.offers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {offer && <OfferScope offer={offer} />}
            <Field className="flex flex-col gap-2">
              <Label htmlFor="quote-term">Initial subscription period</Label>
              <NativeSelect
                id="quote-term"
                value={term}
                onChange={(event) =>
                  setTerm(
                    event.target.value === "paid_pilot"
                      ? "paid_pilot"
                      : "monthly",
                  )
                }
              >
                <option value="monthly">Monthly subscription</option>
                <option value="paid_pilot" disabled={!offer?.pilot}>
                  Paid pilot
                  {offer?.pilot
                    ? ` — ${offer.pilot.days} days`
                    : " — not offered"}
                </option>
              </NativeSelect>
            </Field>
            <Field className="flex flex-col gap-2">
              <Label htmlFor="quote-capacity">Discovery capacity</Label>
              <NativeSelect
                id="quote-capacity"
                value={reservedId}
                onChange={(event) => setReservedId(event.target.value)}
              >
                <option value="">Pooled — no reserved capacity charge</option>
                {offer?.reservedCapacity.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label} — {item.capacity.quantity} {item.capacity.unit}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <p className="text-sm text-muted-foreground">
              Pooled and reserved capacity have the same Business privacy and
              permission boundaries. The saved quote will itemize any selected
              reserved-capacity charge.
            </p>
            {state.currency && offer && (
              <p>
                Base platform price before optional capacity and tax:{" "}
                {quoteMoney(
                  term === "monthly" ? price?.monthlyMinor : price?.pilotMinor,
                  state.currency,
                )}{" "}
                initially; {quoteMoney(price?.monthlyMinor, state.currency)} per
                monthly renewal.
              </p>
            )}
            <QuoteIssues issues={issues} />
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={busy || issues.length > 0}>
                {busy ? "Working…" : "Create quote for review"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await refresh();
                    setMessage(
                      "Saved pricing, billing readiness and quotes refreshed. Your selections remain here.",
                    );
                  })
                }
              >
                Refresh saved state
              </Button>
            </div>
          </FieldGroup>
        </form>
        {error && <Alert variant="destructive">{error}</Alert>}
        {message && <Alert variant="success">{message}</Alert>}
      </section>
      <section className="flex flex-col gap-5" aria-labelledby="saved-quotes">
        <h2 id="saved-quotes" className="text-2xl font-semibold">
          Saved quotes
        </h2>
        {!state.quotes.length && (
          <p>
            No quotes yet. Select configured scope after billing evidence is
            reviewed.
          </p>
        )}
        {state.quotes.toReversed().map((review) => (
          <SubscriptionQuoteSummary key={review.snapshot.id} review={review} />
        ))}
      </section>
    </div>
  );
}
