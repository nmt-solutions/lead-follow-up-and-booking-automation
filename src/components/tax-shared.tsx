import { z } from "zod";
import {
  formatTaxMoney,
  type TaxCalculation,
  type TaxRule,
} from "@/models/tax";
import { BillingProfileSummary } from "./billing-summary";
import { Badge } from "./ui/badge";

export async function readTaxResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  const json: unknown = await response.json();
  if (!response.ok) {
    const failure = z.object({ code: z.string() }).safeParse(json);
    const messages: Record<string, string> = {
      MFA_REQUIRED: "Verify in Security, then retry. Your edits remain here.",
      UNAUTHENTICATED:
        "Sign in again in another tab, then retry. Your edits remain here.",
      CONFLICT:
        "The saved version or review changed. Refresh saved status, check the current evidence and retry.",
      INVALID_INPUT:
        "Check the fields, effective dates, evidence and required decision reason.",
      FORBIDDEN:
        "Your current access does not allow this action. Ask the Business Owner or service operator.",
      NOT_FOUND: "This record is unavailable with your current access.",
    };
    throw new Error(
      (failure.success && messages[failure.data.code]) ||
        "Unable to confirm this operation. Refresh saved status before retrying.",
    );
  }
  const parsed = z
    .object({ success: z.literal(true), data: schema })
    .safeParse(json);
  if (!parsed.success)
    throw new Error(
      "Unable to confirm this operation. Refresh saved status before retrying.",
    );
  return parsed.data.data;
}
export function TaxRuleDetails({ rule }: { rule: TaxRule }) {
  return (
    <div className="space-y-4 wrap-anywhere">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted-foreground">Coverage</dt>
          <dd>
            {rule.customerCountry} /{" "}
            {rule.customerRegion ?? "Entire configured country"} ·{" "}
            {rule.buyerStatus} · {rule.currency} · {rule.productCode}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">
            Effective window (UTC, end excluded)
          </dt>
          <dd>
            {rule.effectiveFrom} to {rule.effectiveUntil ?? "No configured end"}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Jurisdiction</dt>
          <dd>
            {rule.jurisdiction.name} · {rule.jurisdiction.code} ·{" "}
            {rule.jurisdiction.country}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">
            Seller registration or reviewed non-requirement
          </dt>
          <dd>
            {rule.registration.status} · {rule.registration.identifier}
            <br />
            {rule.registration.effectiveFrom} to{" "}
            {rule.registration.effectiveUntil ?? "No configured end"}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Treatment</dt>
          <dd>
            {rule.treatment.replaceAll("_", " ")} · {rule.rationale}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Tax rounding</dt>
          <dd>
            {rule.rounding.mode.replaceAll("_", " ")} ·{" "}
            {rule.rounding.scope.replaceAll("_", " ")} · increment{" "}
            {formatTaxMoney(rule.rounding.incrementMinor, rule.currency)}
          </dd>
        </div>
      </dl>
      <p>
        Required reviewed claims:{" "}
        {rule.requiredEvidence.join(", ").replaceAll("_", " ")}
      </p>
      <ul className="space-y-2">
        {rule.rates.map((rate) => (
          <li key={rate.name}>
            {rate.name}: {rate.numerator} / {rate.denominator} of amount before
            tax
          </li>
        ))}
      </ul>
      <ul className="space-y-2">
        {rule.evidence.map((evidence, index) => (
          <li key={index}>
            {evidence.title} · {evidence.reference} · checked{" "}
            {evidence.checkedAt}
          </li>
        ))}
      </ul>
    </div>
  );
}
const reasonLabels: Record<string, string> = {
  billing_evidence_not_reviewed:
    "Current billing evidence needs operator review",
  billing_currency_mismatch:
    "Currency differs from the current billing profile",
  unsupported_tax_treatment:
    "No effective approved treatment covers this product and customer jurisdiction",
  ambiguous_tax_rules:
    "More than one approved rule covers this line; an operator must resolve the overlap",
  registration_not_effective:
    "Seller registration or non-requirement is outside its approved effective window",
  treatment_evidence_missing:
    "A claim required by the treatment has no supporting document",
  evidence_unavailable: "A billing document has expired or is unavailable",
};
export function TaxRecord({ record }: { record: TaxCalculation }) {
  return (
    <article className="space-y-5 rounded-2xl border border-border bg-card p-6 sm:p-8 wrap-anywhere">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Calculation {record.version}</h3>
        <Badge>
          {record.status === "calculated"
            ? "Calculated from reviewed evidence"
            : "Review required"}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {record.mode === "fixture" ? "Synthetic fixture" : "Live configuration"}{" "}
        · {record.currency} · {record.at} · {record.actorName}
      </p>
      {record.totals ? (
        <dl className="grid gap-4 sm:grid-cols-3">
          {[
            ["Before tax", record.totals.netMinor],
            ["Tax", record.totals.taxMinor],
            ["Total", record.totals.totalMinor],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {formatTaxMoney(value, record.currency)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="font-medium">
          Total unavailable until the review reasons are resolved.
        </p>
      )}
      {!!record.reasons.length && (
        <ul className="list-disc space-y-2 pl-5">
          {record.reasons.map((reason, index) => (
            <li key={index}>
              {reason.kind}:{" "}
              {reasonLabels[reason.code] ?? reason.code.replaceAll("_", " ")}
              {reason.lineId && ` (line ${reason.lineId})`}
            </li>
          ))}
        </ul>
      )}
      <p>{record.note}</p>
      {record.resolvesId && (
        <p className="text-sm text-muted-foreground">
          Successor of review request {record.resolvesId}. The original record
          remains unchanged.
        </p>
      )}
      <details className="rounded-xl border border-border p-4">
        <summary className="cursor-pointer py-2 font-medium focus-visible:outline-2 focus-visible:outline-ring">
          Amounts, evidence and approval snapshots
        </summary>
        <div className="mt-5 space-y-6">
          <p className="text-sm text-muted-foreground">
            Record {record.id} · Profile revision {record.billing.version} ·
            Evidence review {record.billing.reviewVersion}
          </p>
          {record.billing.current && (
            <BillingProfileSummary
              profile={record.billing.current.profile}
              evidence={record.billing.current.evidence}
            />
          )}
          <ul className="space-y-3">
            {record.billing.reviews
              .filter(
                (review) => review.profileId === record.billing.current?.id,
              )
              .map((review) => (
                <li key={review.id}>
                  Evidence review {review.version}: {review.outcome} ·{" "}
                  {review.actorName} · {review.at} · {review.note}
                  {review.findings.length > 0 &&
                    ` · ${review.findings.join("; ")}`}
                </li>
              ))}
          </ul>
          <ul className="space-y-4">
            {record.input.lines.map((line) => (
              <li key={line.id}>
                {line.description} · {line.productCode} · {line.quantity} ×{" "}
                {formatTaxMoney(line.unitAmountMinor, record.currency)} before
                tax
              </li>
            ))}
          </ul>
          {record.lines.map((line) => (
            <section
              key={line.input.id}
              className="space-y-3 border-t border-border pt-4"
            >
              <h4 className="font-semibold">
                {line.input.description}:{" "}
                {formatTaxMoney(line.totalMinor, record.currency)}
              </h4>
              <p>
                {line.components
                  .map(
                    (component) =>
                      `${component.name}: ${formatTaxMoney(component.amountMinor, record.currency)}`,
                  )
                  .join(" · ") || "Explicit reviewed zero-tax treatment"}
              </p>
              <p>
                Rule {line.rule.revision.key} v{line.rule.revision.version} ·
                approved by {line.rule.approval.actorName} ·{" "}
                {line.rule.approval.at} · {line.rule.approval.note}
              </p>
              <TaxRuleDetails rule={line.rule.revision.rule} />
            </section>
          ))}
          {record.status === "review_required" && (
            <section className="space-y-4">
              <h4 className="font-semibold">
                Configuration considered at this request
              </h4>
              {!record.configuration.revisions.length && (
                <p>No configured coverage was available.</p>
              )}
              {record.configuration.revisions.map((revision) => (
                <div
                  key={revision.id}
                  className="space-y-3 border-t border-border pt-4"
                >
                  <p>
                    {revision.key} v{revision.version} · {revision.actorName} ·{" "}
                    {revision.at} · {revision.note}
                  </p>
                  <TaxRuleDetails rule={revision.rule} />
                  <ul>
                    {record.configuration.decisions
                      .filter((decision) => decision.revisionId === revision.id)
                      .map((decision) => (
                        <li key={decision.id}>
                          {decision.outcome} · {decision.actorName} ·{" "}
                          {decision.at} · {decision.note}
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
        </div>
      </details>
      <p className="text-sm text-muted-foreground">
        Tax preview only. This record does not agree a subscription price, issue
        an invoice or authorize a payment.
      </p>
    </article>
  );
}
