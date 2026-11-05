import type { Pool } from "pg";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig } from "drizzle-orm/pg-core";
import { verifyRuntimeRole } from "./runtime";
import { business, membership } from "./schema";

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
    END $$;
  `);
}

/** Idempotent security settings which the pinned Drizzle version cannot express. */
export async function secureDatabase(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const database = drizzle(client);
    // drizzle-kit 0.31 push deliberately omits USING/WITH CHECK expressions.
    // Apply the schema's expressions here, without a second source of truth.
    for (const table of [business, membership]) {
      for (const policy of getTableConfig(table).policies) {
        await database.execute(sql`alter policy ${sql.identifier(policy.name)} on ${table}
          to ${sql.identifier("app_runtime")}
          ${policy.using ? sql`using (${policy.using})` : sql``}
          ${policy.withCheck ? sql`with check (${policy.withCheck})` : sql``}`);
      }
    }
    await client.query(`
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA public TO app_runtime;
      GRANT SELECT, INSERT, UPDATE, DELETE ON "user", session, account, verification, rate_limit TO app_runtime;
      REVOKE ALL PRIVILEGES ON business, membership FROM app_runtime;
      GRANT SELECT, INSERT ON membership, business TO app_runtime;
      GRANT UPDATE (name, offering, home_market, website, updated_at) ON business TO app_runtime;
      ALTER TABLE membership ALTER CONSTRAINT membership_business_id_business_id_fk DEFERRABLE INITIALLY DEFERRED;
      ALTER TABLE business FORCE ROW LEVEL SECURITY;
      ALTER TABLE membership FORCE ROW LEVEL SECURITY;
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
