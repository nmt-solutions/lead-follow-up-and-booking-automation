import { schedules } from "@trigger.dev/sdk";
import { recoverTaxPeriodReminders } from "../tax-periods/worker";

export const taxPeriodReminders = schedules.task({
  id: "recover-tax-period-reminders",
  cron: process.env.TRIGGER_TAX_PERIOD_REMINDER_CRON,
  retry: { maxAttempts: 3 },
  run: async () => {
    try {
      return await recoverTaxPeriodReminders();
    } catch {
      throw new Error(
        "Tax reminder recovery failed. Review configured periods and stages.",
      );
    }
  },
});
