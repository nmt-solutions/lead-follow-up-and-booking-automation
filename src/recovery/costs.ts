import { costSourceSchema, type CostSource } from "../models/costs";
import type { RecoveryPlan } from "../models/infrastructure-recovery";
export function recoveryCostSource(
  plan: RecoveryPlan,
  cost: RecoveryPlan["costs"][number],
): CostSource {
  return costSourceSchema.parse({
    month: cost.observedAt.slice(0, 7),
    provider: cost.provider,
    category:
      cost.provider === "neon"
        ? "database"
        : cost.provider === "trigger"
          ? "workers"
          : cost.provider === "vercel"
            ? "hosting"
            : "tools",
    kind: cost.kind === "commitment" ? "commitment" : "consumption",
    funding: "cash",
    amount:
      cost.micros === null
        ? null
        : { currency: cost.currency, micros: cost.micros },
    quantity: cost.quantity,
    unit: cost.unit,
    businessId: cost.kind === "commitment" ? null : plan.businessId,
    runId: null,
    allocation:
      cost.kind === "commitment"
        ? "Shared selected service commitment"
        : `Business recovery ${cost.kind}`,
    evidence: cost.evidence,
    observedAt: cost.observedAt,
    freshUntil: cost.freshUntil,
    plan: plan.reviewedId,
    status:
      cost.status === "unpriced"
        ? "unpriced"
        : cost.status === "estimated"
          ? "estimated"
          : cost.basis === "billed_charge"
            ? "recorded"
            : "observed_not_settled",
    details: { identity: cost.id, basis: cost.basis, usage: cost.kind },
  });
}
