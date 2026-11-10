import type {
  BillingProfile,
  BillingWorkspace,
  BillingRevision,
} from "@/models/billing";
import { Badge } from "./ui/badge";

export const billingStatuses = {
  missing: "Missing information or evidence",
  conflicting: "Conflicting evidence",
  pending_review: "Awaiting tax-operator review",
  reviewed: "Evidence reviewed",
};
export const evidenceKinds = {
  legal_identity: "Legal identity",
  billing_address: "Billing address",
  business_status: "Business status",
  tax_identifier: "Tax identifiers",
};
const issueLabels: Record<string, string> = {
  legal_name: "Legal name is missing",
  billing_address: "Billing address or country is incomplete",
  invoice_contact: "Invoice contact is incomplete",
  business_status: "Business status is unknown",
  tax_identifier_status: "Tax identifier applicability needs review",
  tax_identifiers: "Tax identifiers are missing",
  legal_identity_evidence: "Legal identity evidence is missing",
  billing_address_evidence: "Billing address evidence is missing",
  business_status_evidence: "Business status evidence is missing",
  tax_identifier_evidence: "Tax identifier evidence is missing",
  evidence_unavailable:
    "An attached document has expired or is unavailable; supply a current copy",
  conflicting_tax_identifiers:
    "Tax identifier statements conflict; resolve the entries",
};
export function BillingProfileSummary({
  profile,
  evidence,
}: {
  profile: BillingProfile;
  evidence: BillingRevision["evidence"];
}) {
  return (
    <dl className="grid gap-5 wrap-anywhere sm:grid-cols-2">
      <div>
        <dt className="text-sm text-muted-foreground">Legal identity</dt>
        <dd>
          {profile.legalName || "Missing"}
          <br />
          {profile.registrationNumber || "Registration number not supplied"}
        </dd>
      </div>
      <div>
        <dt className="text-sm text-muted-foreground">Billing address</dt>
        <dd>
          {[
            profile.address.line1,
            profile.address.line2,
            profile.address.city,
            profile.address.region,
            profile.address.postalCode,
            profile.address.country,
          ]
            .filter(Boolean)
            .join(", ") || "Missing"}
        </dd>
      </div>
      <div>
        <dt className="text-sm text-muted-foreground">Invoice contact</dt>
        <dd>
          {profile.invoiceContact.name || "Missing"}
          <br />
          {profile.invoiceContact.email || "Email missing"}
        </dd>
      </div>
      <div>
        <dt className="text-sm text-muted-foreground">
          Declared purchasing status
        </dt>
        <dd>{profile.businessStatus}</dd>
      </div>
      <div>
        <dt className="text-sm text-muted-foreground">Tax identifiers</dt>
        <dd>
          {profile.taxIdentifierStatus === "not_applicable"
            ? "Customer states not applicable; review required"
            : profile.taxIdentifierStatus === "unknown"
              ? "Applicability unknown"
              : "Identifiers supplied"}
          <ul>
            {profile.taxIdentifiers.map((entry, i) => (
              <li key={i}>
                {entry.kind} · {entry.country} · {entry.value}
              </li>
            ))}
          </ul>
        </dd>
      </div>
      <div>
        <dt className="text-sm text-muted-foreground">Supporting evidence</dt>
        <dd>
          {profile.evidence.length ? (
            <ul className="flex flex-col gap-2">
              {profile.evidence.map((entry, i) => (
                <li key={i}>
                  {evidenceKinds[entry.kind]} ·{" "}
                  {evidence.find((document) => document.fileId === entry.fileId)
                    ?.name ?? "Document unavailable"}
                  : {entry.note}
                </li>
              ))}
            </ul>
          ) : (
            "No evidence attached"
          )}
        </dd>
      </div>
    </dl>
  );
}
export function BillingStatus({ state }: { state: BillingWorkspace }) {
  return (
    <section
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 sm:p-8"
      aria-labelledby="billing-status"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="billing-status" className="text-xl font-semibold">
          Billing readiness
        </h2>
        <Badge>
          {state.current?.profile.declaration && state.status === "reviewed"
            ? "Details confirmed by customer"
            : billingStatuses[state.status]}
        </Badge>
      </div>
      <p>
        Billing country classification:{" "}
        {state.classification === "unknown"
          ? "Unknown"
          : state.classification === "india"
            ? "India"
            : "International"}
        . Billing currency: {state.currency ?? "Not determined"}.
      </p>
      <p className="text-sm text-muted-foreground">
        Billing country is separate from discovery markets and planning exchange
        rates. Identity review assigns no price, tax rate, exemption or export
        treatment.
      </p>
      {state.issues.length > 0 && (
        <ul className="flex flex-col list-inside list-disc gap-2 wrap-anywhere">
          {state.issues.map((issue, i) => (
            <li key={i}>{issueLabels[issue] ?? issue}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
export function BillingHistory({ state }: { state: BillingWorkspace }) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby="billing-history">
      <h2 id="billing-history" className="text-xl font-semibold">
        Profile and review history
      </h2>
      {!state.history.length && (
        <p className="text-muted-foreground">
          No saved billing profile. Save the details you have to route missing
          information for review.
        </p>
      )}
      {[...state.history].reverse().map((revision) => (
        <details
          key={revision.id}
          className="rounded-2xl border border-border bg-card p-6"
        >
          <summary className="min-h-11 cursor-pointer py-2 font-medium wrap-anywhere">
            Revision {revision.version} · {revision.actorName} ·{" "}
            {revision.at.replace("T", " ").replace(".000Z", " UTC")}
          </summary>
          <div className="flex flex-col mt-4 gap-5">
            <p className="whitespace-pre-wrap wrap-anywhere">{revision.note}</p>
            <BillingProfileSummary
              profile={revision.profile}
              evidence={revision.evidence}
            />
            <ul className="flex flex-col gap-3 text-sm">
              {revision.evidence.map((entry) => (
                <li key={entry.fileId} className="wrap-anywhere">
                  {entry.name} · Document retention until {entry.retentionUntil}
                  <br />
                  SHA-256: <span className="font-mono">{entry.sha256}</span>
                </li>
              ))}
            </ul>
            {state.reviews
              .filter((entry) => entry.profileId === revision.id)
              .map((entry) => (
                <div
                  key={entry.id}
                  className="flex flex-col gap-2 rounded-xl border border-border p-4 wrap-anywhere"
                >
                  <p className="font-medium">
                    {billingStatuses[entry.outcome]} · {entry.actorName} ·{" "}
                    {entry.at}
                  </p>
                  <p className="whitespace-pre-wrap">{entry.note}</p>
                  <ul>
                    {entry.findings.map((finding, i) => (
                      <li key={i}>{finding}</li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        </details>
      ))}
    </section>
  );
}
