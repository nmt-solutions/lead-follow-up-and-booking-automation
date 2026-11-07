import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { z } from "zod";
import { bootstrapNotificationSetup } from "../src/application/notification-bootstrap";
import { databaseAdminUrl } from "./database-environment";

async function main() {
  const args = parseArgs({
    options: {
      "operator-user-id": { type: "string" },
      "terms-file": { type: "string" },
    },
    strict: true,
  }).values;
  const input = z
    .object({
      "operator-user-id": z.string().min(1).max(256),
      "terms-file": z.string().min(1),
    })
    .parse(args);
  // The owner URL loader reads only this checkout's configured deployment environment.
  const connectionString = databaseAdminUrl();
  const optional = <T extends z.ZodType>(schema: T) =>
    z.preprocess(
      (value) => (value === "" ? undefined : value),
      schema.optional(),
    );
  const env = z
    .object({
      RESEND_NOTIFICATION_ACCOUNT: z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/),
      RESEND_NOTIFICATION_MODE: z.enum(["production", "test_recipient"]),
      AUTH_EMAIL_FROM: z.email(),
      RESEND_SENDING_DOMAIN_ID: z.uuid(),
      RESEND_API_KEY: z.string().min(1),
      RESEND_SETUP_API_KEY: z.string().min(1),
      BETTER_AUTH_URL: z.url(),
      NOTIFICATION_PAYLOAD_KEY_ID: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
      NOTIFICATION_PAYLOAD_KEYS: z.string().min(1),
      COST_ALERT_EMAIL_FROM: optional(z.email()),
      COST_ALERT_DOMAIN_ID: optional(z.uuid()),
      RESEND_TEST_RECIPIENT: optional(z.email()),
    })
    .refine(
      (value) =>
        value.RESEND_NOTIFICATION_MODE !== "test_recipient" ||
        Boolean(value.RESEND_TEST_RECIPIENT),
    )
    .parse(process.env);
  const keys = z
    .record(z.string(), z.string())
    .parse(JSON.parse(env.NOTIFICATION_PAYLOAD_KEYS));
  if (
    !keys[env.NOTIFICATION_PAYLOAD_KEY_ID] ||
    Buffer.from(keys[env.NOTIFICATION_PAYLOAD_KEY_ID], "base64").byteLength !==
      32
  )
    throw new Error("Payload configuration required");
  const terms: unknown = JSON.parse(
    await readFile(input["terms-file"], "utf8"),
  );
  const pool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
  pool.on("error", () => {});
  try {
    const result = await bootstrapNotificationSetup({
      owner: pool,
      approverId: input["operator-user-id"],
      terms,
      configuration: {
        account: env.RESEND_NOTIFICATION_ACCOUNT,
        mode: env.RESEND_NOTIFICATION_MODE,
        from: env.AUTH_EMAIL_FROM,
        domainId: env.RESEND_SENDING_DOMAIN_ID,
        apiKey: env.RESEND_API_KEY,
        readApiKey: env.RESEND_SETUP_API_KEY,
        webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
        origin: env.BETTER_AUTH_URL,
        costFrom: env.COST_ALERT_EMAIL_FROM,
        costDomainId: env.COST_ALERT_DOMAIN_ID,
        testRecipient: env.RESEND_TEST_RECIPIENT,
      },
    });
    console.info(JSON.stringify(result));
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Auth-only notification bootstrap did not complete. Review owner access, the pre-provisioned notification operator, explicit terms and native sender/usage configuration. No email was sent.",
  );
  process.exitCode = 1;
});
