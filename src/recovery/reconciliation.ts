import type { createFinancialAdjustmentApplication } from "../application/financial-adjustments";
import type { RecoveryControlEvidence } from "./postgres";
import type { RecoveryPlan } from "../models/infrastructure-recovery";

// Reuses the original domain reconciliation command. It polls the ORIGINAL
// native intent/account/identity; it never executes a mutation or invents a key.
export function createRecoveryReconciler<C>(d: {
  financial: ReturnType<typeof createFinancialAdjustmentApplication<C>>;
  credentials: C;
  now(): Date;
  freshSeconds: number;
}) {
  return async (plan: RecoveryPlan): Promise<RecoveryControlEvidence> => {
    const native: RecoveryControlEvidence["native"] = [],
      unresolved = [
        "Fresh target sessions, membership, provider credentials and sender approvals are required before external work can resume",
      ];
    try {
      const before = await d.financial.workspace(
        d.credentials,
        plan.businessId,
        true,
      );
      for (const row of before.cases) {
        await d.financial.refresh(d.credentials, plan.businessId, {
          caseId: row.id,
        });
      }
      const after = await d.financial.workspace(
        d.credentials,
        plan.businessId,
        true,
      );
      for (const row of after.cases) {
        const observation = row.observation;
        native.push({
          source: "financial_case",
          id: row.id,
          nativeId: observation?.nativeId ?? null,
          outcome: observation ? "accepted" : "unknown",
          status: observation?.status ?? null,
          amountMinor: observation?.amountMinor ?? null,
          currency: observation?.currency ?? null,
        });
        if (!observation)
          unresolved.push(`Unresolved original financial intent ${row.id}`);
      }
    } catch {
      unresolved.push(
        "Current authorized native financial evidence is unavailable; do not resend or charge",
      );
    }
    const at = d.now();
    return {
      complete: false,
      observedAt: at.toISOString(),
      expiresAt: new Date(at.getTime() + d.freshSeconds * 1000).toISOString(),
      native,
      unresolved,
    };
  };
}
