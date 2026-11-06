import { schedules } from "@trigger.dev/sdk";
import { recoverOperatorCosts } from "../costs/worker";

export const operatorCostRecovery = schedules.task({
  id: "operator-cost-budgets",
  cron: process.env.TRIGGER_COST_BUDGET_CRON,
  retry: { maxAttempts: 3 },
  run: async () => {
    try {
      return await recoverOperatorCosts();
    } catch {
      throw new Error(
        "Operator cost evaluation failed. Review saved cost coverage and notification status.",
      );
    }
  },
});
