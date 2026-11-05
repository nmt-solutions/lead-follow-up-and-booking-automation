import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

if (!process.env.DATABASE_MIGRATION_URL)
  throw new Error(
    "Set DATABASE_MIGRATION_URL to the direct migration connection.",
  );
const pool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});
try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("Database migrations applied.");
} catch {
  console.error(
    "Migration failed. Check the migration connection and database configuration.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
