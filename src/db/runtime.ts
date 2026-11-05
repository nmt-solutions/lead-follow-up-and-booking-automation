import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import { ApplicationError } from "../models/application-error";
import * as schema from "./schema";

export function runtimeDatabase(pool: Pool) {
  return drizzle(pool, { schema });
}
export type Database = ReturnType<typeof runtimeDatabase>;

// Fail closed on an accidentally supplied Neon schema-owner connection.
export async function verifyRuntimeRole(
  pool: Pool | PoolClient,
): Promise<void> {
  const result = await pool.query<{ safe: boolean }>(`
    SELECT NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb)
      AND current_setting('row_security') = 'on'
      AND (SELECT count(*) = 5 AND bool_and(
        c.relrowsecurity AND c.relforcerowsecurity
        AND NOT pg_has_role(current_user, c.relowner, 'MEMBER')
      ) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('business', 'membership', 'invitation', 'team_audit', 'platform_operator'))
      AND (SELECT count(*) = 13 AND bool_and(
        (policyname = 'membership_owner_read' AND 'public' = ANY(roles) AND qual IS NOT NULL)
        OR ('app_runtime' = ANY(roles) AND CASE policyname
          WHEN 'business_access' THEN qual IS NOT NULL AND with_check IS NOT NULL
          WHEN 'membership_read' THEN qual IS NOT NULL
          WHEN 'membership_create' THEN with_check IS NOT NULL
          WHEN 'membership_change' THEN qual IS NOT NULL AND with_check IS NOT NULL
          WHEN 'membership_remove' THEN qual IS NOT NULL
          WHEN 'invitation_read' THEN qual IS NOT NULL
          WHEN 'invitation_create' THEN with_check IS NOT NULL
          WHEN 'invitation_change' THEN qual IS NOT NULL AND with_check IS NOT NULL
          WHEN 'invitation_expire' THEN qual IS NOT NULL AND with_check IS NOT NULL
          WHEN 'team_audit_read' THEN qual IS NOT NULL
          WHEN 'team_audit_create' THEN with_check IS NOT NULL
          WHEN 'operator_read' THEN qual IS NOT NULL
          ELSE false END)
      ) FROM pg_policies WHERE schemaname = 'public' AND
        ((tablename = 'business' AND policyname = 'business_access') OR
         (tablename = 'membership' AND policyname IN ('membership_read', 'membership_owner_read', 'membership_create', 'membership_change', 'membership_remove')) OR
         (tablename = 'invitation' AND policyname IN ('invitation_read', 'invitation_create', 'invitation_change', 'invitation_expire')) OR
         (tablename = 'team_audit' AND policyname IN ('team_audit_read', 'team_audit_create')) OR
         (tablename = 'platform_operator' AND policyname = 'operator_read'))) AS safe
    FROM pg_roles r WHERE r.rolname = current_user
  `);
  if (result.rows[0]?.safe !== true)
    throw new ApplicationError("SETUP_REQUIRED");
}
