import { schedules } from "@trigger.dev/sdk";
import { recoverTransactionalNotifications } from "../notifications/worker";

export const transactionalNotificationRecovery = schedules.task({
  id: "transactional-notification-recovery",
  cron: process.env.TRIGGER_TRANSACTIONAL_NOTIFICATION_CRON,
  retry: { maxAttempts: 3 },
  run: async () => {
    try {
      return await recoverTransactionalNotifications();
    } catch {
      throw new Error(
        "Transactional notification recovery failed. Review saved setup and delivery status.",
      );
    }
  },
});
