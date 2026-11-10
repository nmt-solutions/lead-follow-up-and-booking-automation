import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Pool } from "pg";
import { databaseAdminUrl } from "./database-environment";
import { publishedOffers, planVersion } from "../src/content/plans";

/** Owner-only release operation. No platform role or payment/tax approval is granted. */
async function main() {
  const email = process.argv[2];
  const expectedVersion = Number(process.argv[3]);
  if (!email || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0)
    throw new Error(
      "Provide the authorizing account email and expected catalog version.",
    );
  const pool = new Pool({ connectionString: databaseAdminUrl(), max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended('subscription-pricing',0))",
    );
    const actor = await client.query<{ id: string; name: string }>(
      'select id,name from public."user" where email=$1 and email_verified=true',
      [email],
    );
    if (actor.rowCount !== 1)
      throw new Error(
        "The authorizing account must exist and have a verified email.",
      );
    const current = await client.query<{ version: number; offers: unknown }>(
      "select version,offers from subscription_pricing_revision order by version desc limit 1",
    );
    if (isDeepStrictEqual(current.rows[0]?.offers, publishedOffers())) {
      await client.query("ROLLBACK");
      console.log("Published plans already match; no revision added.");
      return;
    }
    if ((current.rows[0]?.version ?? 0) !== expectedVersion)
      throw new Error("Catalog changed; review before publishing.");
    await client.query(
      "insert into subscription_pricing_revision(id,version,effective_from,offers,note,actor_id,actor_name,at) values($1,$2,now(),$3,$4,$5,$6,now())",
      [
        randomUUID(),
        expectedVersion + 1,
        JSON.stringify(publishedOffers()),
        `Production monthly plans ${planVersion}; published by the owner release tool at the account holder's request. This catalog does not approve payment activation, tax treatment or provider rights.`,
        actor.rows[0].id,
        actor.rows[0].name,
      ],
    );
    await client.query("COMMIT");
    console.log(
      `Published monthly catalog revision ${expectedVersion + 1}. No customer charged and no access granted.`,
    );
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error &&
      /^(Provide |The authorizing|Catalog changed)/.test(error.message)
      ? error.message
      : "Plan publication failed. Check the owner connection and catalog state.",
  );
  process.exitCode = 1;
});
