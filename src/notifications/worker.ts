import { Pool } from "pg";
import { ApplicationError } from "../models/application-error";
import { databaseConnectionUrl } from "../db/connection";
import { runtimeDatabase, verifyRuntimeRole } from "../db/runtime";
import { configuredNotifications } from "./configuration";

export async function recoverTransactionalNotifications() {
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
    return await configuredNotifications({
      database: runtimeDatabase(pool),
      env: process.env,
      authenticate: async () => {
        throw new ApplicationError("FORBIDDEN");
      },
      authenticatePlatform: async () => {
        throw new ApplicationError("FORBIDDEN");
      },
    }).application.recoverPending();
  } finally {
    await pool.end();
  }
}
