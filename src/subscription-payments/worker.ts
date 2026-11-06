import { Pool } from "pg";
import { runtimeDatabase, verifyRuntimeRole } from "../db/runtime";
import { createSubscriptionPaymentRepository } from "../db/subscription-payment-repository";
import { createSubscriptionPaymentApplication } from "../application/subscription-payments";
import { configuredPayments } from "./configuration";
import { ApplicationError } from "../models/application-error";

export async function recoverSubscriptionPayments() {
  if (!process.env.DATABASE_URL) throw new ApplicationError("SETUP_REQUIRED");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
  pool.on("error", () => {});
  try {
    await verifyRuntimeRole(pool);
    const denied = async () => {
      throw new ApplicationError("FORBIDDEN");
    };
    return await createSubscriptionPaymentApplication({
      authenticate: denied,
      authenticatePlatform: denied,
      repository: createSubscriptionPaymentRepository(runtimeDatabase(pool)),
      clock: { now: () => new Date() },
      gateway: configuredPayments(),
    }).recover();
  } finally {
    await pool.end();
  }
}
