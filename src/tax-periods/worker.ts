import { Pool } from "pg";
import { ApplicationError } from "../models/application-error";
import { databaseConnectionUrl } from "../db/connection";
import { verifyRuntimeRole } from "../db/runtime";

/** Persisted stages recover independently of optional transactional email delivery. */
export async function recoverTaxPeriodReminders() {
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
    const result = await pool.query<{ created: number }>(
      "select public.tax_reporting_due(statement_timestamp()) as created",
    );
    return { created: result.rows[0].created };
  } finally {
    await pool.end();
  }
}
