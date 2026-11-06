import { Pool } from "pg";
import { ApplicationError } from "../models/application-error";
import { runtimeDatabase, verifyRuntimeRole } from "../db/runtime";
import { createCostRepository } from "../db/cost-repository";
import { createCostApplication } from "../application/costs";
import { configuredCostMailer } from "./mailer";

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
    return await createCostApplication({
      authenticatePlatform: async () => {
        throw new ApplicationError("FORBIDDEN");
      },
      repository: createCostRepository(runtimeDatabase(pool)),
      clock: { now: () => new Date() },
      mailer: configuredCostMailer(process.env),
    }).recoverPending();
  } finally {
    await pool.end();
  }
}
