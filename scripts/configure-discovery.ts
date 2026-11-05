import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { databaseAdminUrl } from "./database-environment";
import { createDiscoverySetup } from "../src/application/discovery-setup";
import { runtimeDatabase } from "../src/db/runtime";

// Operator-only provisioning through the schema-owner connection. Business
// request bodies and the restricted runtime cannot grant reach or allowances.
async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Missing configuration file");
  const input: unknown = JSON.parse(await readFile(path, "utf8"));
  const pool = new Pool({
    connectionString: databaseAdminUrl(),
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  try {
    const target = await pool.query(
      "select current_database() as database, current_user as role",
    );
    console.log(
      JSON.stringify({
        event: "discovery_configuration_target",
        ...target.rows[0],
      }),
    );
    await createDiscoverySetup(runtimeDatabase(pool), {
      now: () => new Date(),
    })(input);
    console.log(
      "Discovery policy saved. Provider/worker activation remains a separate gate.",
    );
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Discovery configuration failed. Check the approved policy file, Business and owner connection.",
  );
  process.exitCode = 1;
});
