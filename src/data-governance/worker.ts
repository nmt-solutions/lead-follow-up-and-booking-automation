import { Pool } from "pg";
import { databaseConnectionUrl } from "../db/connection";
import { runtimeDatabase, verifyRuntimeRole } from "../db/runtime";
import { ApplicationError } from "../models/application-error";
import { configuredDataGovernance } from "../server/data-governance-configuration";
import { createDataGovernanceRepository } from "../db/data-governance-repository";
import { createDataGovernanceApplication } from "../application/data-governance";
import { configuredPayments } from "../subscription-payments/configuration";
export async function maintainBusinessData() {
  if (!process.env.DATABASE_URL) throw new ApplicationError("SETUP_REQUIRED");
  const pool = new Pool({
    connectionString: databaseConnectionUrl(process.env.DATABASE_URL),
    max: 2,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
  pool.on("error", () => {});
  try {
    await verifyRuntimeRole(pool);
    return await createDataGovernanceApplication({
      authenticate: async () => {
        throw new ApplicationError("FORBIDDEN");
      },
      repository: createDataGovernanceRepository(runtimeDatabase(pool)),
      clock: { now: () => new Date() },
      ...configuredDataGovernance(
        process.env,
        configuredPayments().mode === "test" ? "test" : "live",
      ),
    }).cleanup();
  } finally {
    await pool.end();
  }
}
