import { schedules } from "@trigger.dev/sdk";
import { recoverFinancialAdjustments } from "../financial-adjustments/worker";

export const reconcileFinancialAdjustments = schedules.task({
  id: "reconcile-financial-adjustments",
  cron: process.env.TRIGGER_FINANCIAL_ADJUSTMENTS_CRON,
  retry: { maxAttempts: 3 },
  run: async () => {
    try {
      return await recoverFinancialAdjustments();
    } catch {
      throw new Error(
        "Financial adjustment reconciliation failed. Review the saved original intent.",
      );
    }
  },
});
