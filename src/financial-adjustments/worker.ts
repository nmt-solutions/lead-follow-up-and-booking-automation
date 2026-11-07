import { Pool } from "pg";
import { runtimeDatabase, verifyRuntimeRole } from "../db/runtime";
import { createFinancialAdjustmentRepository } from "../db/financial-adjustment-repository";
import { createFinancialAdjustmentApplication } from "../application/financial-adjustments";
import { configuredFinancialAdjustments } from "./configuration";
import { ApplicationError } from "../models/application-error";

export async function recoverFinancialAdjustments() {
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
    const denied = async (): Promise<never> => {
      throw new ApplicationError("FORBIDDEN");
    };
    return await createFinancialAdjustmentApplication({
      authenticate: denied,
      authenticatePlatform: denied,
      repository: createFinancialAdjustmentRepository(runtimeDatabase(pool)),
      clock: { now: () => new Date() },
      gateway: configuredFinancialAdjustments(),
      documents: null,
    }).recover();
  } finally {
    await pool.end();
  }
}
