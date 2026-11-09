import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import { prepareDatabaseRole, secureDatabase } from "./setup";

export class DatabaseMigrationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DatabaseMigrationError";
  }
}

/** Owner-only release command. The pool needs two connections for security setup. */
export async function migrateDatabase(pool: Pool, migrationsFolder: string) {
  let migrations: ReturnType<typeof readMigrationFiles>;
  try {
    migrations = readMigrationFiles({ migrationsFolder });
  } catch (cause: unknown) {
    throw new DatabaseMigrationError(
      "Cannot read migrations. Run pnpm db-gen and review the generated files first.",
      { cause },
    );
  }
  if (
    migrations.length === 0 ||
    migrations.some(
      (migration, index) =>
        !Number.isSafeInteger(migration.folderMillis) ||
        migration.folderMillis <= 0 ||
        (index > 0 &&
          migration.folderMillis <= migrations[index - 1].folderMillis),
    )
  )
    throw new DatabaseMigrationError(
      "Migrations must have a nonempty, strictly ordered journal. Review drizzle/meta/_journal.json.",
    );

  const client = await pool.connect();
  let locked = false;
  let stage = "preflight";
  try {
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext('leadrelay'), hashtext('database-migrations')) AS acquired",
    );
    if (!lock.rows[0]?.acquired)
      throw new DatabaseMigrationError(
        "Another database migration is running. Retry after it finishes.",
      );
    locked = true;

    const state = await client.query<{
      quarantined: boolean;
      history: string | null;
      hasTables: boolean;
    }>(`SELECT
      EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='recovery_quarantine') AS quarantined,
      to_regclass('drizzle.__drizzle_migrations')::text AS history,
      EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public') AS "hasTables"`);
    if (state.rows[0].quarantined)
      throw new DatabaseMigrationError(
        "This is a quarantined recovery database. Use the approved recovery workflow.",
      );

    const history = state.rows[0].history
      ? (
          await client.query<{ hash: string; created_at: string }>(
            "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id",
          )
        ).rows
      : [];
    if (history.length === 0 && state.rows[0].hasTables)
      throw new DatabaseMigrationError(
        "This database already has tables but no migration baseline. Review and baseline it before using db-mig; no schema changes were made.",
      );
    if (
      history.some((applied, index) => {
        const committed = migrations[index];
        return (
          !committed ||
          applied.hash !== committed.hash ||
          Number(applied.created_at) !== committed.folderMillis
        );
      })
    )
      throw new DatabaseMigrationError(
        "Applied migration history differs from this release. Restore the original migration files; never edit or remove an applied migration.",
      );

    stage = "security preparation";
    await prepareDatabaseRole(pool);
    stage = "SQL migration";
    await migrate(drizzle(client), {
      migrationsFolder,
      migrationsSchema: "drizzle",
      migrationsTable: "__drizzle_migrations",
    });
    stage = "runtime security verification";
    await secureDatabase(pool);
  } catch (cause: unknown) {
    if (cause instanceof DatabaseMigrationError) throw cause;
    throw new DatabaseMigrationError(
      `Database migration failed during ${stage}. Fix the cause and rerun pnpm db-mig; runtime access may remain paused after security preparation.`,
      { cause },
    );
  } finally {
    if (locked)
      await client
        .query(
          "SELECT pg_advisory_unlock(hashtext('leadrelay'), hashtext('database-migrations'))",
        )
        .catch(() => {});
    // Destroy the session so a failed unlock cannot leave a pooled advisory lock.
    client.release(true);
  }
}
