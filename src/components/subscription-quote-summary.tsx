import type {
  QuoteReview,
  SubscriptionOffer,
} from "@/models/subscription-quotes";
import {
  metaDisclosure,
  quoteIssueLabels,
  reachDisclosure,
} from "@/models/subscription-quotes";
import { BillingProfileSummary } from "./billing-summary";
import { Badge } from "./ui/badge";

export function quoteMoney(
  amount: number | null | undefined,
  currency: "INR" | "USD",
) {
  return amount == null
    ? "Not configured"
    : new Intl.NumberFormat("en", {
        style: "currency",
        currency,
        currencyDisplay: "code",
      }).format(amount / 100);
}
export function QuoteIssues({ issues }: { issues: string[] }) {
  return issues.length ? (
    <ul className="list-disc space-y-2 pl-5 text-sm">
      {issues.map((issue) => (
        <li key={issue}>
          {quoteIssueLabels[issue] ??
            "Review the current commercial setup with the operator."}
        </li>
      ))}
    </ul>
  ) : null;
}
export function SubscriptionDisclosures() {
  return (
    <section
      className="space-y-3 rounded-2xl border border-border bg-muted p-6"
      aria-label="Separate charges and scope"
    >
      <h2 className="text-xl font-semibold">Two separate bills</h2>
      <p>{metaDisclosure}</p>
      <p className="text-sm text-muted-foreground">{reachDisclosure}</p>
      <p className="text-sm text-muted-foreground">
        Tax treatment and the final payable total require a separate
        calculation. A quote does not activate a gateway, charge a payment
        method or grant paid entitlements.
      </p>
    </section>
  );
}
export function OfferScope({ offer }: { offer: SubscriptionOffer }) {
  return (
    <div className="space-y-2 text-sm wrap-anywhere">
      <p>Discovery reach: {offer.markets.join(", ")}</p>
      <p>
        Monthly discovery:{" "}
        {offer.discovery
          ? `${offer.discovery.quantity} ${offer.discovery.unit}`
          : "Not configured"}
        . Monthly automation:{" "}
        {offer.automation
          ? `${offer.automation.quantity} ${offer.automation.unit}`
          : "Not configured"}
        .
      </p>
      {offer.pilot && (
        <p>
          Paid pilot: {offer.pilot.days} days. Total discovery:{" "}
          {offer.pilot.discovery
            ? `${offer.pilot.discovery.quantity} ${offer.pilot.discovery.unit}`
            : "Not configured"}
          . Total automation:{" "}
          {offer.pilot.automation
            ? `${offer.pilot.automation.quantity} ${offer.pilot.automation.unit}`
            : "Not configured"}
          .
        </p>
      )}
      <p className="text-muted-foreground">{offer.renewalTerms}</p>
    </div>
  );
}
export function SubscriptionQuoteSummary({ review }: { review: QuoteReview }) {
  const q = review.snapshot;
  const reserved = q.pricing.reservedCapacity;
  return (
    <article
      className="space-y-6 rounded-2xl border border-border bg-card p-6 sm:p-8"
      aria-labelledby={`quote-${q.id}`}
    >
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3
            id={`quote-${q.id}`}
            className="text-xl font-semibold wrap-anywhere"
          >
            {q.pricing.offer.label}
          </h3>
          <Badge>
            {review.commercialReady
              ? "Commercial terms current"
              : "Needs a new quote"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground wrap-anywhere">
          Created {new Date(q.at).toLocaleString("en", { timeZone: "UTC" })} UTC
          by {q.actorName}. Price version {q.pricing.version}; billing revision{" "}
          {q.profile.version}.
        </p>
        <QuoteIssues issues={review.issues} />
      </header>
      <OfferScope offer={q.pricing.offer} />
      <p>
        Capacity:{" "}
        {reserved
          ? `${reserved.label} — ${reserved.capacity.quantity} ${reserved.capacity.unit}`
          : "Pooled discovery; no reserved capacity charge"}
        . Privacy and Business permissions apply in either mode.
      </p>
      <div className="grid gap-6 sm:grid-cols-2">
        <section className="space-y-3" aria-label="Initial platform charges">
          <h4 className="font-semibold">
            {q.initial.kind === "paid_pilot"
              ? `${q.initial.days}-day paid pilot`
              : "Initial month"}
          </h4>
          <ul className="space-y-2">
            {q.initial.lines.map((line) => (
              <li
                key={line.kind}
                className="flex flex-wrap justify-between gap-2"
              >
                <span>{line.label}</span>
                <span>{quoteMoney(line.amountMinor, q.currency)}</span>
              </li>
            ))}
          </ul>
          <p className="font-semibold">
            Platform subtotal: {quoteMoney(q.initial.subtotalMinor, q.currency)}
          </p>
          <p className="text-sm">
            Included: {q.initial.discovery.quantity} {q.initial.discovery.unit};{" "}
            {q.initial.automation.quantity} {q.initial.automation.unit} during
            this {q.initial.kind === "paid_pilot" ? "pilot" : "month"}.
          </p>
        </section>
        <section className="space-y-3" aria-label="Monthly renewal charges">
          <h4 className="font-semibold">Monthly renewal</h4>
          <ul className="space-y-2">
            {q.renewal.lines.map((line) => (
              <li
                key={line.kind}
                className="flex flex-wrap justify-between gap-2"
              >
                <span>{line.label}</span>
                <span>{quoteMoney(line.amountMinor, q.currency)}</span>
              </li>
            ))}
          </ul>
          <p className="font-semibold">
            Platform subtotal: {quoteMoney(q.renewal.subtotalMinor, q.currency)}{" "}
            / month
          </p>
          <p className="text-sm">
            Included per month: {q.renewal.discovery.quantity}{" "}
            {q.renewal.discovery.unit}; {q.renewal.automation.quantity}{" "}
            {q.renewal.automation.unit}.
          </p>
        </section>
      </div>
      <p>
        Tax: not calculated. Final payable total: unavailable. Meta charges are
        separate and excluded from both platform subtotals.
      </p>
      <details className="rounded-xl border border-border p-4">
        <summary className="cursor-pointer font-medium">
          Reviewed billing details used for this quote
        </summary>
        <div className="mt-4">
          <BillingProfileSummary
            profile={q.profile.profile}
            evidence={q.profile.evidence}
          />
        </div>
      </details>
      <p className="text-sm text-muted-foreground">
        Checkout unavailable: tax calculation and gateway checkout are still
        required. This record preserves the terms for review; it is not an
        invoice, payment approval or an activated subscription.
      </p>
      <p className="text-xs text-muted-foreground wrap-anywhere">
        Quote reference: {q.id}
      </p>
    </article>
  );
}
