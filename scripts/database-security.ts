import { Pool } from "pg";
import { prepareDatabaseRole, secureDatabase } from "../src/db/setup";
import { databaseAdminUrl } from "./database-environment";

async function main() {
  const mode = process.argv[2];
  if (mode !== "prepare" && mode !== "secure")
    throw new Error("Unknown database setup step.");
  const pool = new Pool({
    connectionString: databaseAdminUrl(),
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  try {
    if (mode === "prepare") await prepareDatabaseRole(pool);
    else await secureDatabase(pool);
    console.log(
      mode === "prepare"
        ? "Database runtime role is ready."
        : "Database grants, RLS and transaction constraints verified.",
    );
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error(
    "Database security setup failed. Check DATABASE_ADMIN_URL and the database role privileges.",
  );
  process.exitCode = 1;
});
