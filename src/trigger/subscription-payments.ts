import { schedules } from "@trigger.dev/sdk";
import { recoverSubscriptionPayments } from "../subscription-payments/worker";

export const reconcileSubscriptionPayments = schedules.task({
  id: "reconcile-subscription-payments",
  cron: process.env.TRIGGER_PAYMENT_RECOVERY_CRON,
  retry: { maxAttempts: 3 },
  run: async () => {
    try {
      return await recoverSubscriptionPayments();
    } catch {
      throw new Error(
        "Subscription payment recovery failed. Review the persisted payment state.",
      );
    }
  },
});
