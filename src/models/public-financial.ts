import { paymentSnapshotSchema } from "./subscription-payments";
import { taxCalculationSchema } from "./tax";
import { publicTaxCalculation } from "../tax/projection";

/** Original ledger evidence stays private. Project only the transaction's agreement. */
export function publicFinancialValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicFinancialValue);
  if (!value || typeof value !== "object") return value;
  const tax =
    "purpose" in value && value.purpose === "tax_preview"
      ? taxCalculationSchema.safeParse(value)
      : null;
  const entries = Object.entries(
    tax?.success ? publicTaxCalculation(tax.data) : value,
  );
  const paymentProvider =
    entries.some(([k, v]) => k === "key" && typeof v === "string") &&
    entries.some(([k]) => k === "account") &&
    entries.some(([k]) => k === "mode");
  const methodReview = entries.some(
    ([k, v]) => k === "kind" && v === "method_review",
  );
  const projected = Object.fromEntries(
    entries
      .filter(
        ([k]) =>
          !(paymentProvider && k === "review") &&
          !(methodReview && k === "body") &&
          k !== "checkoutProof",
      )
      .map(([k, v]) => [k, publicFinancialValue(v)]),
  );
  const snapshot = entries.some(([key]) => key === "quote")
    ? paymentSnapshotSchema.safeParse(value)
    : null;
  if (snapshot?.success) {
    const s = snapshot.data;
    projected.tax = publicTaxCalculation(s.tax);
    const plan = s.provider.review?.plans.find(
      (p) =>
        p.offerId === s.quote.selection.offerId &&
        p.reservedCapacityId === s.quote.selection.reservedCapacityId &&
        p.currency === s.quote.currency,
    );
    if (plan && s.term.kind === "calendar_month" && !s.adjustment)
      projected.collection = {
        method: s.upi ? "upi" : "card",
        planId: plan.planId,
        totalCount: plan.totalCount,
      };
  }
  return projected;
}
