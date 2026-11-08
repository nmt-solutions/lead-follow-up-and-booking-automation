import { schedules } from "@trigger.dev/sdk";
import { maintainBusinessData } from "../data-governance/worker";
export const businessDataMaintenance = schedules.task({
  id: "maintain-business-data",
  cron: process.env.TRIGGER_BUSINESS_DATA_CRON,
  retry: { maxAttempts: 3 },
  run: async () => {
    try {
      return await maintainBusinessData();
    } catch {
      throw new Error(
        "Business data cleanup is incomplete. Review approved policy and maintenance history.",
      );
    }
  },
});
