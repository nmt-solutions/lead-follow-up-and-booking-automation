import { productionCron } from "./cron";
import { schedules } from "@trigger.dev/sdk";
import { maintainOperationRetention } from "../operations/worker";

export const operationsRetention = schedules.task({
  id: "maintain-operation-diagnostics",
  cron: productionCron(process.env.TRIGGER_OPERATIONS_RETENTION_CRON),
  retry: { maxAttempts: 3 },
  run: async () => {
    try {
      return await maintainOperationRetention();
    } catch {
      throw new Error(
        "Diagnostic maintenance failed. Review configured policy and worker health.",
      );
    }
  },
});
