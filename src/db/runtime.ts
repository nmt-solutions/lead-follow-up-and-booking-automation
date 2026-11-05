import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { ApplicationError } from "../models/application-error";
import * as schema from "./schema";

export function runtimeDatabase(pool: Pool) {
  return drizzle(pool, { schema });
}
export type Database = ReturnType<typeof runtimeDatabase>;

// Fail closed on an accidentally supplied Neon migration/owner connection.
export async function verifyRuntimeRole(pool: Pool): Promise<void> {
  const result = await pool.query<{ safe: boolean }>(`
    SELECT NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole)
      AND current_setting('row_security') = 'on'
      AND (SELECT count(*) = 2 AND bool_and(
        c.relrowsecurity AND c.relforcerowsecurity
        AND NOT pg_has_role(current_user, c.relowner, 'MEMBER')
      ) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('business', 'membership')) AS safe
    FROM pg_roles r WHERE r.rolname = current_user
  `);
  if (result.rows[0]?.safe !== true)
    throw new ApplicationError("SETUP_REQUIRED");
}
