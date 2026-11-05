import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { z } from "zod";
import { databaseAdminUrl } from "./database-environment";
import { discoveryPolicySchema } from "../src/models/discovery";

// Operator-only provisioning through the schema-owner connection. Business
// request bodies and the restricted runtime cannot grant reach or allowances.
async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Missing configuration file");
  const input = z
    .strictObject({ businessId: z.uuid(), policy: discoveryPolicySchema })
    .parse(JSON.parse(await readFile(path, "utf8")));
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
        businessId: input.businessId,
      }),
    );
    await pool.query(
      "insert into discovery_configuration (business_id, policy) values ($1, $2) on conflict (business_id) do update set policy=excluded.policy",
      [input.businessId, input.policy],
    );
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
