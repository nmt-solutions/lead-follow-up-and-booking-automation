import type { Pool } from "pg";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig } from "drizzle-orm/pg-core";
import { verifyRuntimeRole } from "./runtime";
import {
  business,
  membership,
  invitation,
  teamAudit,
  platformOperator,
} from "./schema";

/** Role setup is separate because Drizzle does not model all privilege attributes. */
export async function prepareDatabaseRole(pool: Pool) {
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
        CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
      END IF;
    END $$;
  `);
  const result = await pool.query<{ safe: boolean }>(`
    SELECT NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb) AS safe
    FROM pg_roles WHERE rolname = 'app_runtime'
  `);
  if (result.rows[0]?.safe !== true)
    throw new Error(
      "app_runtime has unsafe privileges. Review the role before pushing.",
    );
  // PostgreSQL 16+ may grant the creator ADMIN without SET. Allow the owner to
  // verify the runtime role, never the reverse membership that would bypass RLS.
  await pool.query(
    "GRANT app_runtime TO CURRENT_USER WITH INHERIT FALSE, SET TRUE",
  );
  // Narrow definer helpers avoid recursive membership RLS. PL/pgSQL resolves
  // tables at execution, so they can be installed before the first schema push.
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.current_business_role() RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
    BEGIN RETURN (SELECT m.role FROM public.membership m
      WHERE m.business_id = nullif(current_setting('app.business_id', true), '')::uuid
      AND m.user_id = nullif(current_setting('app.actor_id', true), '')); END $$;
    CREATE OR REPLACE FUNCTION public.inviter_authorized(inviter text, invited_role text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
    BEGIN RETURN EXISTS (SELECT 1 FROM public.membership m
      WHERE m.business_id = nullif(current_setting('app.business_id', true), '')::uuid
      AND m.user_id = inviter AND (m.role = 'owner' OR (m.role = 'admin' AND invited_role = 'salesperson'))); END $$;
    REVOKE ALL ON FUNCTION public.current_business_role(), public.inviter_authorized(text, text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.current_business_role(), public.inviter_authorized(text, text) TO app_runtime;
  `);
  // A push can replace policy definitions. Pause protected access until the
  // final security transaction restores complete policies and privileges.
  await pool.query(`
    DO $$ BEGIN
      IF to_regclass('public.business') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.business FROM app_runtime;
        REVOKE ALL PRIVILEGES (name, offering, home_market, website, updated_at) ON public.business FROM app_runtime;
      END IF;
      IF to_regclass('public.membership') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.membership FROM app_runtime;
      END IF;
      IF to_regclass('public.invitation') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.invitation FROM app_runtime;
        REVOKE ALL PRIVILEGES (status, accepted_by, accepted_at, delivery, delivery_started_at) ON public.invitation FROM app_runtime;
      END IF;
      IF to_regclass('public.team_audit') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.team_audit FROM app_runtime;
      END IF;
      IF to_regclass('public.platform_operator') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.platform_operator FROM app_runtime;
      END IF;
    END $$;
  `);
}

/** Idempotent security settings which the pinned Drizzle version cannot express. */
export async function secureDatabase(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const database = drizzle(client);
    // The pinned push also misses changes to an existing CHECK expression.
    // Upgrade the original owner-only role check from the schema's definition.
    for (const constraint of getTableConfig(membership).checks) {
      await database.execute(
        sql`alter table ${membership} drop constraint if exists ${sql.identifier(constraint.name)}`,
      );
      await database.execute(
        sql`alter table ${membership} add constraint ${sql.identifier(constraint.name)} check (${constraint.value})`,
      );
    }
    // drizzle-kit 0.31 push deliberately omits USING/WITH CHECK expressions.
    // Apply the schema's expressions here, without a second source of truth.
    for (const table of [
      business,
      membership,
      invitation,
      teamAudit,
      platformOperator,
    ]) {
      for (const policy of getTableConfig(table).policies) {
        await database.execute(sql`alter policy ${sql.identifier(policy.name)} on ${table}
          to ${policy.to === "public" ? sql`public` : sql.identifier("app_runtime")}
          ${policy.using ? sql`using (${policy.using})` : sql``}
          ${policy.withCheck ? sql`with check (${policy.withCheck})` : sql``}`);
      }
    }
    await client.query(`
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA public TO app_runtime;
      GRANT SELECT, INSERT, UPDATE, DELETE ON "user", session, account, verification, rate_limit, two_factor TO app_runtime;
      REVOKE ALL PRIVILEGES ON business, membership, invitation, team_audit, platform_operator FROM app_runtime;
      GRANT SELECT, INSERT ON membership, business, invitation, team_audit TO app_runtime;
      GRANT SELECT ON platform_operator TO app_runtime;
      GRANT UPDATE (role) ON membership TO app_runtime;
      GRANT DELETE ON membership TO app_runtime;
      GRANT UPDATE (status, accepted_by, accepted_at, delivery, delivery_started_at) ON invitation TO app_runtime;
      GRANT UPDATE (name, offering, home_market, website, updated_at) ON business TO app_runtime;
      ALTER TABLE membership ALTER CONSTRAINT membership_business_id_business_id_fk DEFERRABLE INITIALLY DEFERRED;
      ALTER TABLE business FORCE ROW LEVEL SECURITY;
      ALTER TABLE membership FORCE ROW LEVEL SECURITY;
      ALTER TABLE invitation FORCE ROW LEVEL SECURITY;
      ALTER TABLE team_audit FORCE ROW LEVEL SECURITY;
      ALTER TABLE platform_operator FORCE ROW LEVEL SECURITY;
      SET LOCAL ROLE app_runtime;
    `);
    await verifyRuntimeRole(client);
    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
