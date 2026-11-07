import { z } from "zod";
import { createNotificationApplication } from "../application/notifications";
import { createNotificationRepository } from "../db/notification-repository";
import type { Database } from "../db/runtime";
import type { Actor } from "../models/business";
import { notificationVault } from "./vault";
import { createResendProvider } from "./resend";

/** Deployment credentials never enter a client module, operator form or log. */
export function configuredNotifications<C>(options: {
  database: Database;
  env: NodeJS.ProcessEnv;
  authenticate(c: C): Promise<Actor>;
  authenticatePlatform(c: C): Promise<Actor>;
}) {
  const env = options.env;
  const account = z
    .string()
    .regex(/^[a-zA-Z0-9_.:-]{1,100}$/)
    .safeParse(env.RESEND_NOTIFICATION_ACCOUNT);
  const domain = z.uuid().safeParse(env.RESEND_SENDING_DOMAIN_ID);
  const mode = z
    .enum(["production", "test_recipient"])
    .safeParse(env.RESEND_NOTIFICATION_MODE);
  const from = z.email().safeParse(env.AUTH_EMAIL_FROM);
  const costFrom = z.email().safeParse(env.COST_ALERT_EMAIL_FROM);
  const costDomain = z.uuid().safeParse(env.COST_ALERT_DOMAIN_ID);
  const recipient = z.email().safeParse(env.RESEND_TEST_RECIPIENT);
  const keys: Record<string, Uint8Array> = {};
  try {
    const ring = z
      .record(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), z.string())
      .parse(JSON.parse(env.NOTIFICATION_PAYLOAD_KEYS ?? "{}"));
    for (const [id, encoded] of Object.entries(ring)) {
      const key = Buffer.from(encoded, "base64");
      if (key.byteLength === 32) keys[id] = key;
    }
  } catch {
    /* Status exposes configuration presence only. */
  }
  const activeKey = env.NOTIFICATION_PAYLOAD_KEY_ID ?? "";
  const configuration = {
    account: account.success ? account.data : "unconfigured",
    domainId: domain.success
      ? domain.data
      : "00000000-0000-4000-8000-000000000000",
    mode: mode.success ? mode.data : ("test_recipient" as const),
    from: from.success ? from.data : "unconfigured@example.invalid",
    apiKey: env.RESEND_API_KEY ?? "",
    readApiKey: env.RESEND_SETUP_API_KEY,
    webhookSecret: env.RESEND_WEBHOOK_SECRET,
    previousWebhookSecret: env.RESEND_PREVIOUS_WEBHOOK_SECRET,
    previousWebhookValidUntil: env.RESEND_PREVIOUS_WEBHOOK_VALID_UNTIL,
    webhookRotatedAt: env.RESEND_WEBHOOK_ROTATED_AT,
    origin: env.BETTER_AUTH_URL ?? "http://localhost:3000",
    costFrom: costFrom.success ? costFrom.data : undefined,
    costDomainId: costDomain.success ? costDomain.data : undefined,
    testRecipient: recipient.success ? recipient.data : undefined,
  };
  const native = createResendProvider(configuration);
  const application = createNotificationApplication({
    ...options,
    repository: createNotificationRepository(options.database),
    configuration,
    vault: notificationVault({ activeKey, keys }),
    provider: {
      ...native,
      inspect: () =>
        account.success && domain.success && mode.success && from.success
          ? native.inspect()
          : Promise.resolve({
              retryAfterSeconds: 0,
              sendingReady: false,
              senders: [],
              receivingReady: false,
              domain: configuration.from.split("@")[1],
              domainStatus: "configuration_required",
              accountIdentity: "configured_credential_set",
              readAccess: "missing",
              sendingKey: "configured",
              usage: null,
            }),
    },
    recoveryConfigured: Boolean(
      env.TRIGGER_TRANSACTIONAL_NOTIFICATION_CRON?.trim(),
    ),
    deployment: {
      account: account.success,
      domain: domain.success,
      mode: mode.success,
      payloadKey: Boolean(keys[activeKey]),
      readKey: Boolean(env.RESEND_SETUP_API_KEY),
      sendingKey: Boolean(env.RESEND_API_KEY),
    },
  });
  return {
    application,
    costEmailConfigured:
      costFrom.success &&
      Boolean(configuration.apiKey) &&
      Boolean(keys[activeKey]) &&
      account.success &&
      domain.success &&
      mode.success,
  };
}
