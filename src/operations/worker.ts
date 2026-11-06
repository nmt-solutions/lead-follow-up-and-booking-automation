import { Pool } from "pg";
import { runtimeDatabase, verifyRuntimeRole } from "../db/runtime";
import { createOperationsRepository } from "../db/operations-repository";
import { createOperationsApplication } from "../application/operations";
import { ApplicationError } from "../models/application-error";
import { databaseConnectionUrl } from "../db/connection";

export async function maintainOperationRetention() {
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
    return await createOperationsApplication({
      authenticate: async () => {
        throw new ApplicationError("FORBIDDEN");
      },
      repository: createOperationsRepository(runtimeDatabase(pool), {
        now: () => new Date(),
      }),
      commands: {},
    }).maintainRetention();
  } finally {
    await pool.end();
  }
}
