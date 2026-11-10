import type { DocumentSnapshot } from "../models/seller-documents";
import { formatTaxMoney } from "../models/tax";
import { ApplicationError } from "../models/application-error";

const text = (value: string) =>
  value.replace(/[\r\n\t\x00-\x1f\x7f]+/g, " ").trim();
const indiaDate = (value: string) =>
  new Date(Date.parse(value) + 330 * 60000).toISOString().slice(0, 10);
/** Customer invoice fields only. Operator approvals, costs, evidence and worker identities stay private. */
export function renderIndiaInvoice(document: {
  number: string;
  kind: "invoice" | "credit_note";
  at: string;
  snapshot: DocumentSnapshot;
}) {
  const snapshot = document.snapshot,
    issuer = snapshot.issuer.revision.configuration;
  const customer = snapshot.financial.tax.billing.current?.profile;
  if (
    !customer ||
    snapshot.currency !== "INR" ||
    issuer.seller.country !== "IN" ||
    (document.kind === "credit_note" && !snapshot.original?.at)
  )
    throw new ApplicationError("SELLER_DOCUMENT_SETUP_REQUIRED");
  const money = (value: string) => formatTaxMoney(value, snapshot.currency);
  const sac = issuer.legalFields.find((field) => field.label === "SAC")?.value;
  if (!sac) throw new ApplicationError("SELLER_DOCUMENT_SETUP_REQUIRED");
  const lines = [
    `${document.kind === "invoice" ? text(issuer.template.invoiceTitle) : text(issuer.template.creditTitle)} ${text(document.number)}`,
    `Issue date (India): ${indiaDate(document.at)}`,
    "",
    "SUPPLIER",
    text(issuer.seller.legalName),
    text(issuer.seller.address),
    text(issuer.seller.contact),
    ...issuer.legalFields.map(
      (field) => `${text(field.label)}: ${text(field.value)}`,
    ),
    "",
    "BILL TO",
    text(customer.legalName),
    text(Object.values(customer.address).filter(Boolean).join(", ")),
    `${text(customer.invoiceContact.name)}: ${text(customer.invoiceContact.email)}`,
    ...customer.taxIdentifiers.map(
      (identifier) => `${text(identifier.kind)}: ${text(identifier.value)}`,
    ),
    ...(!customer.taxIdentifiers.length
      ? ["Recipient GSTIN: not supplied"]
      : []),
    "",
    `Service period (UTC): ${snapshot.source.start} to ${snapshot.source.end}`,
    `Payment reference: ${text(snapshot.source.paymentId)}`,
    ...(snapshot.original?.at
      ? [
          `Original invoice: ${text(snapshot.original.number)}`,
          `Original invoice date (India): ${indiaDate(snapshot.original.at)}`,
          "Amounts below reduce the original invoice.",
        ]
      : []),
    ...(snapshot.adjustment
      ? [`Credit reason: ${text(snapshot.adjustment.reason)}`]
      : []),
    "",
    "SERVICE AND TAX",
    ...snapshot.lines.flatMap((line) => [
      `${text(line.input.description)} · SAC ${text(sac)}`,
      `Quantity: ${line.input.quantity}; unit price: ${money(line.input.unitAmountMinor)}`,
      `Taxable value: ${money(line.netMinor)}`,
      `Place of supply: ${text(line.rule.revision.rule.jurisdiction.name)}`,
      ...line.components.map((component) => {
        const rate = line.rule.revision.rule.rates.find(
          (item) => item.name === component.name,
        );
        if (!rate) throw new ApplicationError("SELLER_DOCUMENT_SETUP_REQUIRED");
        return `${text(component.name)} ${(Number(rate.numerator) / Number(rate.denominator)) * 100}%: ${money(component.amountMinor)}`;
      }),
      `Line total: ${money(line.totalMinor)}`,
      "",
    ]),
    `Taxable total: ${money(snapshot.totals.netMinor)}`,
    `GST total: ${money(snapshot.totals.taxMinor)}`,
    `Total: ${money(snapshot.totals.totalMinor)}`,
    "",
    text(issuer.template.footer),
    "Electronically generated and retained.",
    "",
  ];
  return new TextEncoder().encode(lines.join("\n"));
}
