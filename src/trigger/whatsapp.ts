import { schedules } from "@trigger.dev/sdk";
import { drainMetaIntake } from "../whatsapp/worker";
import { recoverMetaSends } from "../whatsapp/sending-worker";

const metaSchedulingEnabled = [
  "META_TECH_PROVIDER_APPROVED",
  "META_BUSINESS_VERIFIED",
  "META_APP_REVIEW_APPROVED",
  "META_APP_LIVE",
  "META_COEXISTENCE_ONBOARDING_APPROVED",
].every((key) => process.env[key] === "true");

export const recoverWhatsAppSends = schedules.task({
  id: "recover-whatsapp-sends",
  cron: metaSchedulingEnabled ? "* * * * *" : undefined,
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
  cron: metaSchedulingEnabled ? "* * * * *" : undefined,
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
