import type { DocumentSnapshot } from "../models/seller-documents";
import { formatTaxMoney } from "../models/tax";

/** Deterministic UTF-8 attachment. A template version never changes after issuance. */
export function renderSellerDocument(document: {
  id: string;
  number: string;
  kind: "invoice" | "credit_note";
  actorId: string;
  at: string;
  snapshot: DocumentSnapshot;
}) {
  const s = document.snapshot,
    c = s.issuer.revision.configuration;
  const money = (v: string) => formatTaxMoney(v, s.currency);
  const customer = s.financial.tax.billing.current!.profile;
  const lines = [
    `${document.kind === "invoice" ? c.template.invoiceTitle : c.template.creditTitle} ${document.number}`,
    `Issued: ${document.at}`,
    `Document ID: ${document.id}`,
    `Issued by: ${document.actorId}`,
    "",
    "SELLER",
    c.seller.legalName,
    c.seller.address,
    c.seller.country,
    c.seller.contact,
    ...c.legalFields.map((f) => `${f.label}: ${f.value}`),
    "",
    "CUSTOMER",
    customer.legalName,
    customer.registrationNumber,
    ...Object.values(customer.address).filter(Boolean),
    `${customer.invoiceContact.name}: ${customer.invoiceContact.email}`,
    ...customer.taxIdentifiers.map(
      (t) => `${t.kind} (${t.country}): ${t.value}`,
    ),
    "",
    "TRANSACTION",
    `Document mode: ${c.mode}; Payment mode: ${s.financial.provider.mode}`,
    `Payment: ${s.source.paymentId}`,
    ...(s.source.charge
      ? [
          `Provider: ${s.source.charge.provider}; account: ${s.source.charge.account}`,
          `Subscription: ${s.source.charge.subscriptionId ?? "unavailable"}; paid at: ${s.source.charge.paidAt ?? "unavailable"}`,
          ...(s.source.charge.charge
            ? [
                `Provider invoice: ${s.source.charge.charge.invoiceId}; order: ${s.source.charge.charge.orderId}; plan: ${s.source.charge.charge.planId}`,
              ]
            : []),
        ]
      : []),
    `Period: ${s.source.start} to ${s.source.end}`,
    ...(s.financial.adjustment
      ? [
          `Charge basis: prorated reach expansion v${s.financial.adjustment.version}; change ${s.financial.adjustment.changeId}; original paid source ${s.financial.adjustment.originalPeriodId}`,
          `Monthly net basis: ${money(s.financial.adjustment.pricing.fromMonthlyNetMinor)} to ${money(s.financial.adjustment.pricing.toMonthlyNetMinor)}; exact proration ${s.financial.adjustment.proration.numerator}/${s.financial.adjustment.proration.denominator}, ${s.financial.adjustment.proration.basis}, half-up, UTC`,
          `Approved policy: ${s.financial.adjustment.policy.id} v${s.financial.adjustment.policy.version}; reviewed by ${s.financial.adjustment.policy.reviewedBy}`,
        ]
      : []),
    `Billing currency: ${s.currency}; precision: ${s.precision}`,
    ...(s.original
      ? [
          `Original invoice: ${s.original.number} (${s.original.id})`,
          `Original seller: ${s.original.issuer.revision.configuration.seller.legalName}; issuer version ${s.original.issuer.revision.version}`,
          "Amounts below are credits reducing the original invoice.",
        ]
      : []),
    ...(s.adjustment
      ? [
          `Adjustment: ${s.adjustment.adjustmentId}`,
          `Source: ${s.adjustment.source.kind} ${s.adjustment.source.reference}`,
          `Reason: ${s.adjustment.reason}`,
          ...s.adjustment.evidence.map((e) => `Adjustment evidence: ${e}`),
          `Allocation: ${s.adjustment.allocation}`,
        ]
      : []),
    "",
    "LINES",
    ...s.lines.flatMap((l) => [
      `${l.input.id}: ${l.input.description}`,
      `Quantity: ${l.input.quantity}; original unit price: ${money(l.input.unitAmountMinor)}`,
      `Net: ${money(l.netMinor)}; tax: ${money(l.taxMinor)}; total: ${money(l.totalMinor)}`,
      ...l.components.map((t) => `  ${t.name}: ${money(t.amountMinor)}`),
      `Treatment: ${l.rule.revision.rule.treatment}; jurisdiction: ${l.rule.revision.rule.jurisdiction.name}`,
      `Registration: ${l.rule.revision.rule.registration.identifier}`,
      `Tax rule: ${l.rule.revision.key} v${l.rule.revision.version}; approval: ${l.rule.approval.id}`,
      ...l.rule.revision.rule.rates.map(
        (r) => `  ${r.name}: ${r.numerator}/${r.denominator}`,
      ),
      `Rounding: ${l.rule.revision.rule.rounding.mode}, ${l.rule.revision.rule.rounding.scope}, increment ${l.rule.revision.rule.rounding.incrementMinor} minor units`,
      ...l.rule.revision.rule.evidence.map(
        (e) => `Evidence: ${e.title}; ${e.reference}; checked ${e.checkedAt}`,
      ),
    ]),
    "",
    `Net: ${money(s.totals.netMinor)}`,
    `Tax: ${money(s.totals.taxMinor)}`,
    `Total: ${money(s.totals.totalMinor)}`,
    "",
    `Issuer configuration: v${s.issuer.revision.version}; approval: ${s.issuer.approval.id}`,
    `Customer revision: ${s.financial.tax.billing.current!.id}; pricing revision: ${s.financial.quote.pricing.version}`,
    ...s.financial.tax.billing.current!.evidence.map(
      (e) => `Customer evidence: ${e.name}; SHA-256 ${e.sha256}`,
    ),
    ...c.evidence.map(
      (e) =>
        `Seller review: ${e.title}; ${e.reference}; checked ${e.checkedAt}`,
    ),
    `Retention policy: ${c.retention.policyReference}`,
    "",
    c.template.footer,
    "",
  ];
  return new TextEncoder().encode(lines.join("\n"));
}
