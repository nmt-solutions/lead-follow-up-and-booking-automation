import { Pool } from "pg";
import { runtimeDatabase, verifyRuntimeRole } from "../db/runtime";
import { databaseConnectionUrl } from "../db/connection";
import { createWhatsAppIntakeRepository } from "../db/whatsapp-intake-repository";
import { configuredMetaCloud } from "./configuration";
import { configuredMetaWebhook } from "./intake-configuration";
import { createWhatsAppIntakeApplication } from "../application/whatsapp-intake";
import { ApplicationError } from "../models/application-error";
export async function drainMetaIntake() {
  if (!process.env.DATABASE_URL)
    throw new Error("WhatsApp worker database unavailable");
  const pool = new Pool({
    connectionString: databaseConnectionUrl(process.env.DATABASE_URL),
    max: 2,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
  pool.on("error", () =>
    console.error(JSON.stringify({ event: "whatsapp_database_unavailable" })),
  );
  try {
    await verifyRuntimeRole(pool);
    const clock = { now: () => new Date() };
    const composition = configuredMetaCloud(process.env, fetch, clock);
    const configuration = configuredMetaWebhook(process.env);
    if (!configuration?.workerConfigured)
      throw new Error("WhatsApp intake worker deployment is unconfirmed");
    const app = createWhatsAppIntakeApplication<void>({
      authenticate: async () => {
        throw new ApplicationError("FORBIDDEN");
      },
      repository: createWhatsAppIntakeRepository(runtimeDatabase(pool), clock),
      clock,
      ...composition,
      configuration,
    });
    return await app.drain();
  } finally {
    await pool.end();
  }
}
