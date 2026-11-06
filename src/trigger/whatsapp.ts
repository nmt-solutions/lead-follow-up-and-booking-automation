import { schedules } from "@trigger.dev/sdk";
import { drainMetaIntake } from "../whatsapp/worker";
import { recoverMetaSends } from "../whatsapp/sending-worker";
export const recoverWhatsAppSends = schedules.task({
  id: "recover-whatsapp-sends",
  cron: "* * * * *",
  queue: { concurrencyLimit: 1 },
  retry: { maxAttempts: 3 },
  maxDuration: 120,
  run: async () => {
    try {
      return await recoverMetaSends();
    } catch {
      throw new Error(
        "WhatsApp send recovery unavailable; review saved account, approval and allowance",
      );
    }
  },
});
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
