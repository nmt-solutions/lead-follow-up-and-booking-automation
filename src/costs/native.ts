import { z } from "zod";
import { costSourceSchema, type CostSource } from "../models/costs";

export const nativeCostRowSchema = z.object({
  source_id: z.string().startsWith("native:"),
  kind: z.enum([
    "ai",
    "discovery",
    "storage",
    "mailbox_job",
    "native_mail",
    "ordinary_mail",
    "sequence_mail",
    "meta",
    "payment",
    "transactional",
    "pilot_effort",
  ]),
  business_id: z.uuid().nullable(),
  run_id: z.uuid().nullable(),
  at: z.coerce.date(),
  details: z.record(
    z.string(),
    z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
  ),
});
export function nativeCost(
  row: z.infer<typeof nativeCostRowSchema>,
  month: string,
): CostSource {
  const d = row.details;
  const at = row.at.toISOString();
  const base: CostSource = {
    month,
    provider: row.kind,
    category: "tools",
    kind: "consumption",
    funding: "unknown",
    amount: null,
    quantity: 1,
    unit: "attempt",
    businessId: row.business_id,
    runId: row.run_id,
    allocation: "Direct usage attributed by the application",
    evidence: row.source_id,
    observedAt: at,
    freshUntil: at,
    plan: null,
    status: "unpriced",
    details: d,
  };
  if (row.kind === "ai") {
    base.category = "ai";
    base.provider = d.route === "gateway_system" ? "ai_gateway" : "openai";
    base.funding =
      d.route === "gateway_system"
        ? "gateway_prepaid"
        : d.funding === "linked_api_credits"
          ? "openai_linked_credits"
          : "openai_purchased_credits";
    // A Gateway debit covers the system route. Upstream provider price is context, never another expense.
    const dollars =
      d.route === "gateway_system" ? d.gatewayCostUsd : d.providerCostUsd;
    if (typeof dollars === "number" && dollars >= 0) {
      base.amount = {
        currency: "USD",
        micros: Math.round(dollars * 1_000_000).toString(),
      };
      base.status = "observed_not_settled";
    }
  } else if (row.kind === "pilot_effort") {
    base.provider = "pilot_effort";
    base.category = [
      "setup",
      "support",
      "sales",
      "billing_tax",
      "maintenance",
    ].includes(String(d.kind))
      ? costSourceSchema.shape.category.parse(d.kind)
      : "tools";
    base.unit = "operator_recorded_second";
    base.quantity = typeof d.seconds === "number" ? d.seconds : null;
    base.allocation =
      "Attributable recorded human effort expense; not a fabricated hourly rate, provider expense or bank settlement";
    if (
      d.measurement === "attributed_actual_input" &&
      (d.currency === "INR" || d.currency === "USD") &&
      typeof d.spendMinor === "string" &&
      /^\d{1,15}$/.test(d.spendMinor)
    ) {
      base.amount = {
        currency: d.currency,
        micros: (BigInt(d.spendMinor) * 10000n).toString(),
      };
      base.status = "observed_not_settled";
    }
  } else if (row.kind === "payment") {
    base.category = "payment";
    base.provider =
      typeof d.provider === "string" ? d.provider : "payment_gateway";
    base.funding = "cash";
    base.status = "observed_not_settled";
    // Razorpay fee is the total fee, including its reported fee tax. Do not add tax a second time.
    if (
      typeof d.feeMinor === "string" &&
      /^\d+$/.test(d.feeMinor) &&
      d.baseCurrency === "INR"
    )
      base.amount = {
        currency: "INR",
        micros: (BigInt(d.feeMinor) * 10000n).toString(),
      };
  } else if (row.kind === "discovery") {
    base.provider = typeof d.adapter === "string" ? d.adapter : "discovery";
    base.category = d.kind === "review" ? "ai" : "search";
    base.quantity = 1;
    base.unit = `${d.kind}_request`;
    if (d.kind === "review") {
      base.provider = "discovery_allowance";
      base.quantity =
        typeof d.allowanceUnits === "number" ? d.allowanceUnits : null;
      base.unit = "allowance_units";
      base.kind = "subscription_allocation";
      base.allocation =
        "Discovery allowance only; AI attempt sources carry provider costs";
    } else if (typeof d.estimatedUsd === "number") {
      base.amount = {
        currency: "USD",
        micros: Math.round(d.estimatedUsd * 1_000_000).toString(),
      };
      base.status = "estimated";
    }
  } else if (row.kind === "meta") {
    base.provider = "meta";
    base.category = "messaging";
    base.kind = "customer_paid_meta";
    base.funding = "customer_meta";
    base.unit = "message";
    base.allocation =
      "Paid directly by the Business; excluded from operator totals and platform billing";
  } else if (row.kind === "transactional") {
    base.provider = "resend";
    base.category = "messaging";
    base.unit = "transactional_email";
    base.funding =
      d.funding === "existing_subscription"
        ? "existing_subscription"
        : "unknown";
    base.plan = typeof d.selectedTerms === "string" ? d.selectedTerms : null;
    base.allocation =
      "Platform authentication and authorized notices; selected plan commitment is context, not a per-email charge";
    base.quantity =
      d.outcome === "rejected" || d.outcome === "rate_limited" ? 0 : 1;
    if (d.acceptanceUncertain === true) {
      base.quantity = 1;
      base.status = "uncertain";
    }
  } else if (row.kind === "storage") {
    base.provider = "r2";
    base.category = "hosting";
    base.unit = typeof d.action === "string" ? d.action : "operation";
  } else if (row.kind === "mailbox_job") {
    base.category = "workers";
    base.unit = "sync_job";
  } else {
    if (typeof d.provider === "string") base.provider = d.provider;
    base.category = "messaging";
    base.unit = row.kind === "native_mail" ? "message" : "send_attempt";
  }
  if (
    !base.amount &&
    [
      "reserved",
      "uncertain",
      "attempt_reserved",
      "dispatch_boundary",
      "acceptance_unknown",
      "unknown",
    ].includes(String(d.outcome))
  )
    base.status = "uncertain";
  return costSourceSchema.parse(base);
}
