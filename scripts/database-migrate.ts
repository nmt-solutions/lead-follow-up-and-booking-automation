import { resolve } from "node:path";
import { Pool } from "pg";
import { DatabaseMigrationError, migrateDatabase } from "../src/db/migrations";
import { databaseAdminUrl } from "./database-environment";

async function main() {
  const pool = new Pool({
    connectionString: databaseAdminUrl(),
    max: 2,
    connectionTimeoutMillis: 10000,
  });
  try {
    await migrateDatabase(pool, resolve("drizzle"));
    console.log("Database migrations and runtime security verified.");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof DatabaseMigrationError
      ? error.message
      : "Database migration failed. Check DATABASE_ADMIN_URL and the owner's permissions.",
  );
  process.exitCode = 1;
});
