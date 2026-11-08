import { Pool } from "pg";
import { ApplicationError } from "../models/application-error";
import { runtimeDatabase, verifyRuntimeRole } from "../db/runtime";
import { createCostRepository } from "../db/cost-repository";
import { createCostApplication } from "../application/costs";
import { configuredNotifications } from "../notifications/configuration";

export async function recoverOperatorCosts() {
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
    const stream = configuredNotifications({
      database: runtimeDatabase(pool),
      env: process.env,
      authenticate: async () => {
        throw new ApplicationError("FORBIDDEN");
      },
      authenticatePlatform: async () => {
        throw new ApplicationError("FORBIDDEN");
      },
    });
    return await createCostApplication({
      authenticatePlatform: async () => {
        throw new ApplicationError("FORBIDDEN");
      },
      repository: createCostRepository(runtimeDatabase(pool)),
      clock: { now: () => new Date() },
      mailer: stream.costEmailConfigured ? stream.application.costMailer : null,
    }).recoverPending();
  } finally {
    await pool.end();
  }
}
