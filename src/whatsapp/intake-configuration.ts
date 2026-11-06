import type { MetaWebhookConfiguration } from "../application/whatsapp-intake";
export function configuredMetaWebhook(
  env: Readonly<Record<string, string | undefined>>,
): MetaWebhookConfiguration | null {
  if (!env.META_APP_SECRET || !env.META_WEBHOOK_VERIFY_TOKEN) return null;
  return {
    appSecret: env.META_APP_SECRET,
    verifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
    workerConfigured: env.META_INTAKE_WORKER_DEPLOYMENT_CONFIRMED === "true",
  };
}
