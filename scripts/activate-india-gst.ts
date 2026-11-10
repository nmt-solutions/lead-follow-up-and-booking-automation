import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { Pool } from "pg";
import { databaseAdminUrl } from "./database-environment";
import {
  indiaGstDrafts,
  indiaIssuerDraft,
  indiaIssuerConfiguration,
} from "../src/production/india-gst";
import { taxRuleSchema } from "../src/models/tax";
import { issuerConfigurationSchema } from "../src/models/seller-documents";

/** Explicit owner release after actual merchant declarations; never called by customer routes. */
async function main() {
  const email = process.argv[2];
  if (
    !email ||
    !process.argv.includes("--regular") ||
    !process.argv.includes("--below-einvoice-threshold")
  )
    throw new Error(
      "Confirmed regular scheme and historical turnover eligibility are required.",
    );
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
    const rules = await client.query<{
      id: string;
      key: string;
      rule: unknown;
      decision: string | null;
    }>(
      "select distinct on(r.key) r.id,r.key,r.rule,(select d.outcome from tax_rule_decision d where d.revision_id=r.id order by d.version desc limit 1) as decision from tax_rule_revision r where r.key like 'leadrelay-in-%-standard-gst' order by r.key,r.version desc",
    );
    if (rules.rowCount !== 72)
      throw new Error("Expected exact prepared domestic rules.");
    for (const row of rules.rows) {
      const rule = taxRuleSchema.parse(row.rule);
      const expected = indiaGstDrafts(new Date(rule.effectiveFrom)).find(
        (item) => item.key === row.key,
      );
      if (
        !expected ||
        !isDeepStrictEqual(expected.rule, rule) ||
        (row.decision && row.decision !== "approved")
      )
        throw new Error(
          "Prepared tax policy changed or was withdrawn; review required.",
        );
    }
    const issuers = await client.query<{
      id: string;
      version: number;
      configuration: unknown;
      decision: string | null;
    }>(
      "select r.id,r.version,r.configuration,(select d.outcome from seller_issuer_decision d where d.revision_id=r.id order by d.version desc limit 1) as decision from seller_issuer_revision r order by r.version desc limit 1",
    );
    const existing = issuers.rows[0];
    if (!existing) throw new Error("Prepared issuer required.");
    const configuration = issuerConfigurationSchema.parse(
      existing.configuration,
    );
    const approvedFormat =
      configuration.template.format === "india_gst_text_v2";
    const expected = approvedFormat
      ? indiaIssuerConfiguration(new Date(configuration.effectiveFrom))
      : indiaIssuerDraft(new Date(configuration.effectiveFrom));
    if (
      !isDeepStrictEqual(configuration, expected) ||
      (configuration.effectiveUntil &&
        new Date(configuration.effectiveUntil) <= new Date()) ||
      (existing.decision && existing.decision !== "approved")
    )
      throw new Error("Prepared issuer changed, expired or was withdrawn.");
    if (
      approvedFormat &&
      existing.decision === "approved" &&
      rules.rows.every((row) => row.decision === "approved")
    ) {
      await client.query("ROLLBACK");
      console.log(
        "Domestic GST and invoice configuration already active; no decisions duplicated.",
      );
      return;
    }
    const at = new Date();
    const evidence =
      JSON.stringify(
        {
          source:
            "Account-holder declarations in the active setup conversation",
          recordedAt: at.toISOString(),
          authorizingAccountId: actor.rows[0].id,
          regularTaxpayer: true,
          historicalCompanyPanTurnoverExceedsFiveCrore: false,
        },
        null,
        2,
      ) + "\n";
    const hash = createHash("sha256").update(evidence).digest("hex");
    await mkdir(".local", { recursive: true });
    await writeFile(
      `.local/merchant-tax-confirmation-${at.getTime()}.json`,
      evidence,
      { flag: "wx" },
    );
    const note = `Standard domestic SaaS GST release authorized by the account holder. Merchant eligibility declaration retained privately; evidence SHA-256 ${hash}. No CA/portal verification, filing, remittance, invoice or customer charge is asserted.`;
    for (const row of rules.rows)
      if (!row.decision)
        await client.query(
          "insert into tax_rule_decision(id,revision_id,version,outcome,note,actor_id,actor_name,at) values($1,$2,1,'approved',$3,$4,$5,$6)",
          [
            randomUUID(),
            row.id,
            note,
            actor.rows[0].id,
            actor.rows[0].name,
            at,
          ],
        );
    let issuerId = existing.id;
    if (!approvedFormat) {
      issuerId = randomUUID();
      await client.query(
        "insert into seller_issuer_revision(id,version,configuration,actor_id,at,note) values($1,$2,$3,$4,$5,$6)",
        [
          issuerId,
          existing.version + 1,
          JSON.stringify(indiaIssuerConfiguration(at)),
          actor.rows[0].id,
          at,
          note,
        ],
      );
    }
    if (!approvedFormat || !existing.decision)
      await client.query(
        "insert into seller_issuer_decision(id,revision_id,version,outcome,actor_id,at,note) values($1,$2,1,'approved',$3,$4,$5)",
        [randomUUID(), issuerId, actor.rows[0].id, at, note],
      );
    await client.query("COMMIT");
    console.log(
      "Activated 72 standard domestic GST rules and the versioned India invoice issuer. Private merchant declarations retained outside public responses. No customer charged and no invoice issued.",
    );
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Domestic GST activation failed; check declarations, prepared policy and owner access. Values are suppressed.",
  );
  process.exitCode = 1;
});
