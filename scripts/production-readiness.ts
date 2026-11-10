import { isDeepStrictEqual } from "node:util";
import { Pool } from "pg";
import { configure, deployments } from "@trigger.dev/sdk";
import { databaseAdminUrl } from "./database-environment";
import { publishedOffers } from "../src/content/plans";
import { productionSubscriptionIssues } from "../src/production/subscriptions";

/** Private operator report: counts and status only; never credentials or customer records. */
async function main() {
  const pool = new Pool({
    connectionString: databaseAdminUrl(),
    max: 1,
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
  });
  const issues = productionSubscriptionIssues();
  try {
    const catalog = await pool.query<{ offers: unknown }>(
      "select offers from subscription_pricing_revision where effective_from<=now() order by version desc limit 1",
    );
    if (!isDeepStrictEqual(catalog.rows[0]?.offers, publishedOffers()))
      issues.push("published_catalog_mismatch");
    const setup = await pool.query<{
      tax: boolean;
      issuer: boolean;
      discovery: number;
      businesses: number;
    }>(`select
      exists(select 1 from tax_rule_revision r where r.rule->>'mode'='live' and (r.rule->>'effectiveFrom')::timestamptz<=now() and ((r.rule->>'effectiveUntil') is null or (r.rule->>'effectiveUntil')::timestamptz>now()) and (select d.outcome from tax_rule_decision d where d.revision_id=r.id order by d.version desc limit 1)='approved') as tax,
      exists(select 1 from seller_issuer_revision r where r.configuration->>'mode'='live' and (r.configuration->>'effectiveFrom')::timestamptz<=now() and ((r.configuration->>'effectiveUntil') is null or (r.configuration->>'effectiveUntil')::timestamptz>now()) and (select d.outcome from seller_issuer_decision d where d.revision_id=r.id order by d.version desc limit 1)='approved') as issuer,
      (select count(*)::int from discovery_configuration) as discovery,
      (select count(*)::int from business) as businesses`);
    if (!setup.rows[0]?.tax) issues.push("approved_live_tax_coverage_required");
    if (!setup.rows[0]?.issuer)
      issues.push("approved_live_invoice_issuer_required");
    if (setup.rows[0].discovery < setup.rows[0].businesses)
      issues.push("discovery_provisioning_incomplete");
    console.log(JSON.stringify({ catalog: "checked", ...setup.rows[0] }));
    if (process.env.TRIGGER_SECRET_KEY) {
      configure({ secretKey: process.env.TRIGGER_SECRET_KEY });
      try {
        const current = await deployments.retrieveCurrent();
        console.log(
          JSON.stringify({ worker: current.status, version: current.version }),
        );
        if (current.status !== "DEPLOYED")
          issues.push("promoted_worker_required");
      } catch {
        issues.push("promoted_worker_unavailable");
      }
    }
    console.log(JSON.stringify({ ready: issues.length === 0, issues }));
    if (issues.length) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Production readiness inspection failed; secret values are suppressed.",
  );
  process.exitCode = 1;
});
