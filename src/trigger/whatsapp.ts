import { schedules } from "@trigger.dev/sdk";
import { drainMetaIntake } from "../whatsapp/worker";
/** Durable poll discovers accepted receipts after web/worker interruption without carrying private payloads in jobs. */
export const recoverWhatsAppIntake = schedules.task({
  id: "recover-whatsapp-intake",
  cron: "* * * * *",
  queue: { concurrencyLimit: 1 },
  retry: { maxAttempts: 3 },
  maxDuration: 120,
  run: async () => {
    try {
      return await drainMetaIntake();
    } catch {
      throw new Error(
        "WhatsApp intake recovery unavailable; review saved connection and deployment",
      );
    }
  },
});
