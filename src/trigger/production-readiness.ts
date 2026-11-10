import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { Pool } from "pg";
import { databaseConnectionUrl } from "../db/connection";
import { verifyRuntimeRole } from "../db/runtime";

/** Operator probe: no customer records, provider calls, messages or payment mutations. */
export const productionReadiness = schemaTask({
  id: "production-readiness",
  schema: z.strictObject({}),
  queue: { concurrencyLimit: 1 },
  retry: { maxAttempts: 1 },
  maxDuration: 60,
  run: async (_payload, { ctx }) => {
    const pool = new Pool({
      connectionString: databaseConnectionUrl(process.env.DATABASE_URL ?? ""),
      max: 1,
      connectionTimeoutMillis: 10000,
      statement_timeout: 15000,
    });
    try {
      await verifyRuntimeRole(pool);
      return {
        database: "restricted_role_verified",
        version: ctx.run.version,
        environment: ctx.environment.type,
      };
    } catch {
      throw new Error(
        "Production worker database security verification failed.",
      );
    } finally {
      await pool.end();
    }
  },
});
