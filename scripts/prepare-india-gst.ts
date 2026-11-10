import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Pool } from "pg";
import { databaseAdminUrl } from "./database-environment";
import { indiaGstDrafts, indiaIssuerDraft } from "../src/production/india-gst";

/** Owner-only preparation. Never approves rules, grants roles, issues an invoice or charges a customer. */
async function main() {
  const email = process.argv[2];
  if (!email) throw new Error("Authorizing account email required.");
  const pool = new Pool({
    connectionString: databaseAdminUrl(),
    max: 1,
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended('subscription-tax-rules',0)),pg_advisory_xact_lock(hashtextextended('seller-documents',0))",
    );
    const actor = await client.query<{ id: string; name: string }>(
      'select id,name from public."user" where email=$1 and email_verified=true',
      [email],
    );
    if (actor.rowCount !== 1)
      throw new Error("Verified authorizing account required.");
    const existing = await client.query(
      "select count(*)::int as count from tax_rule_revision where key like 'leadrelay-in-%-standard-gst'",
    );
    const issuers = await client.query<{
      version: number;
      configuration: { seller: unknown };
    }>(
      "select version,configuration from seller_issuer_revision order by version desc limit 1",
    );
    if (existing.rows[0]?.count || issuers.rowCount) {
      if (
        existing.rows[0]?.count === 72 &&
        isDeepStrictEqual(
          issuers.rows[0]?.configuration.seller,
          indiaIssuerDraft(new Date()).seller,
        )
      ) {
        console.log(
          "India GST and issuer drafts already exist; no records changed.",
        );
        await client.query("ROLLBACK");
        return;
      }
      throw new Error(
        "Existing tax/issuer configuration needs review; nothing overwritten.",
      );
    }
    const at = new Date();
    const note =
      "Draft prepared at the account holder's request. SAC 998315 / 18% standard domestic GST researched from official sources. Regular taxpayer scheme, active registration and e-invoice applicability not independently confirmed. No approval or customer charge.";
    for (const draft of indiaGstDrafts(at))
      await client.query(
        "insert into tax_rule_revision(id,key,version,rule,note,actor_id,actor_name,at) values($1,$2,1,$3,$4,$5,$6,$7)",
        [
          randomUUID(),
          draft.key,
          JSON.stringify(draft.rule),
          note,
          actor.rows[0].id,
          actor.rows[0].name,
          at,
        ],
      );
    await client.query(
      "insert into seller_issuer_revision(id,version,configuration,actor_id,at,note) values($1,1,$2,$3,$4,$5)",
      [
        randomUUID(),
        JSON.stringify(indiaIssuerDraft(at)),
        actor.rows[0].id,
        at,
        note,
      ],
    );
    await client.query("COMMIT");
    console.log(
      "Prepared 72 domestic GST rule drafts and one financial-year invoice/credit-note issuer draft. No approvals, invoices, access grants or charges created.",
    );
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "India GST preparation failed. Check owner access and existing configuration; values are suppressed.",
  );
  process.exitCode = 1;
});
