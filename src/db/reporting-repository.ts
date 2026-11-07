import type { Database } from "./runtime";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import {
  businessReportSchema,
  type ReportMetric,
  type ReportQuery,
} from "../models/reporting";
import { scoped, requireCapability } from "./scope";
import { requireSalesSession } from "./sales-session";
import { and, eq, gte, lte } from "drizzle-orm";
import { discoveryEvidenceAt } from "./discovery-repository";
import { discoveryRun, discoveryUsage } from "./schema";
import type { ReportDetail } from "../models/reporting";
import { collectSalesReport } from "./reporting-sales";
import { collectCommunicationReport } from "./reporting-communication";

export function createReportingRepository(database: Database, clock: Clock) {
  return {
    read(
      identity: WorkIdentity,
      businessId: string,
      query: ReportQuery & { from: string; to: string },
    ) {
      return scoped(
        database,
        identity,
        businessId,
        async (tx) => {
          const role = await requireCapability(
            tx,
            identity,
            businessId,
            "sales.work",
          );
          await requireSalesSession(tx, identity, clock.now(), role);
          const at = clock.now();
          const inWindow = (v: Date | string) =>
            new Date(v) >= new Date(query.from) &&
            new Date(v) <= new Date(query.to);
          const metrics: ReportMetric[] = [
            ...(
              [
                [
                  "contact_accuracy",
                  "Independently reviewed contact accuracy",
                  "discovery",
                  "No independently labeled reviewed cohort is recorded. Named-role coverage is a separate measurement.",
                ],
                [
                  "human_hours",
                  "Business sales effort duration",
                  "activity",
                  "Calls and manual actions record activity, without measured duration. Counts and elapsed wall time cannot establish hours.",
                ],
                [
                  "discovery_actual_cost",
                  "Actual discovery provider charge",
                  "cost",
                  "No actual Business/run-attributable provider invoice charge is recorded here. Allowance units and provider estimates are separate.",
                ],
              ] satisfies [string, string, ReportMetric["group"], string][]
            ).map(([id, label, group, definition]): ReportMetric => ({
              id,
              label,
              group,
              definition,
              value: null,
              denominator: null,
              ratio: null,
              unit: "unavailable",
              status: "unavailable",
              cohort: "Retained records",
            })),
          ];
          const items: ReportDetail[] = [];
          function metric(
            id: string,
            label: string,
            group: ReportMetric["group"],
            value: number | null,
            denominator: number | null,
            definition: string,
            cohort: string,
            unit = "records",
            status: ReportMetric["status"] = "recorded",
          ) {
            metrics.push({
              id,
              label,
              group,
              value,
              denominator,
              ratio:
                value !== null &&
                denominator !== null &&
                denominator > 0 &&
                value <= denominator
                  ? value / denominator
                  : null,
              definition,
              cohort,
              unit,
              status,
            });
          }
          const evidence = await discoveryEvidenceAt(tx, businessId, at);
          const observed = evidence.observations.filter((o) =>
            inWindow(o.checkedAt),
          );
          const cohortIds = new Set(observed.map((o) => o.prospectId));
          const prospects = evidence.prospects.filter((p) =>
            cohortIds.has(p.id),
          );
          const current = prospects.filter((p) =>
            p.history.some((h) => h.current),
          );
          const discoveryCohort =
            "Canonical prospects with a retained observation checked in the inclusive selected interval. Current source state and expiry evaluated at report generation.";
          metric(
            "observed_prospects",
            "Unique observed prospects",
            "discovery",
            prospects.length,
            null,
            "Distinct canonical prospect/need identities, not people or companies; repeated runs and retries count once.",
            discoveryCohort,
            "prospects",
          );
          metric(
            "new_prospects",
            "First observed prospects",
            "discovery",
            prospects.filter((p) => inWindow(p.firstCheckedAt)).length,
            prospects.length,
            "Prospects whose earliest retained observation falls in the interval / unique observed prospects. Earlier erased history can limit first-observed claims.",
            discoveryCohort,
            "prospects",
          );
          metric(
            "matched_observations",
            "Matched source observations",
            "discovery",
            observed.length,
            null,
            "Retained matched observations, including repeat research; these are not new unique prospects.",
            "Observation checked time in interval",
            "observations",
          );
          for (const outcome of ["created", "refreshed", "duplicate"] as const)
            metric(
              `${outcome}_observations`,
              `${outcome} observations`,
              "discovery",
              observed.filter((o) => o.outcome === outcome).length,
              observed.length,
              "Immutable discovery consolidation result / matched observations. Legacy observations are retained separately in the denominator.",
              "Observation checked time in interval",
              "observations",
            );
          metric(
            "fit_current",
            "Currently supported fit",
            "discovery",
            current.length,
            prospects.length,
            "Cohort prospects still established by their latest source check / unique observed prospects. Model-supported fit is not independently measured accuracy.",
            discoveryCohort,
            "prospects",
          );
          metric(
            "source_coverage",
            "Retained source coverage",
            "discovery",
            prospects.filter((p) => p.evidence.length > 0).length,
            prospects.length,
            "Prospects with retained source URL, excerpt and check date / unique observed prospects. Source existence does not establish current fit.",
            discoveryCohort,
            "prospects",
          );
          metric(
            "contactable",
            "Contactable prospects",
            "discovery",
            current.filter((p) => p.contactStatus !== "missing").length,
            prospects.length,
            "Currently source-supported usable public route / unique observed prospects. Contact availability grants no sending permission.",
            discoveryCohort,
            "prospects",
          );
          metric(
            "named_roles",
            "Named purchasing-role coverage",
            "discovery",
            current.filter((p) =>
              p.contacts.some((c) => c.name && c.roleEvidence),
            ).length,
            prospects.length,
            "Current named person with explicit purchasing/owner role evidence / unique observed prospects. Independent contact accuracy remains unavailable.",
            discoveryCohort,
            "prospects",
          );
          metric(
            "general_contacts",
            "General-contact-only prospects",
            "discovery",
            current.filter(
              (p) => p.contactStatus === "general_business_contact",
            ).length,
            prospects.length,
            "Usable public route without a confirmed named buyer route / unique observed prospects.",
            discoveryCohort,
            "prospects",
          );
          metric(
            "missing_contacts",
            "Prospects without a current route",
            "discovery",
            prospects.filter(
              (p) => !current.includes(p) || p.contactStatus === "missing",
            ).length,
            prospects.length,
            "No currently source-supported usable route / unique observed prospects.",
            discoveryCohort,
            "prospects",
          );
          const requests = prospects.filter((p) => p.request !== null);
          for (const [id, label, states] of [
            ["open_requests", "Source-observed open requests", ["open"]],
            [
              "uncertain_requests",
              "Unknown or undated requests",
              ["uncertain", "undated"],
            ],
            ["expired_requests", "Expired requests", ["expired"]],
          ] satisfies [string, string, string[]][])
            metric(
              id,
              label,
              "discovery",
              requests.filter((p) => states.includes(p.requestState ?? ""))
                .length,
              requests.length,
              "Canonical requests in this source state / retained request-bearing cohort prospects. Open is a dated source claim checked at the displayed time, not live independent confirmation.",
              discoveryCohort,
              "requests",
            );
          const usage = await tx
            .select({
              id: discoveryUsage.id,
              runId: discoveryUsage.runId,
              at: discoveryUsage.at,
              kind: discoveryUsage.kind,
              units: discoveryUsage.units,
              outcome: discoveryUsage.outcome,
              providerCost: discoveryUsage.providerCost,
              returnedResults: discoveryUsage.returnedResults,
            })
            .from(discoveryUsage)
            .where(
              and(
                eq(discoveryUsage.businessId, businessId),
                gte(discoveryUsage.at, new Date(query.from)),
                lte(discoveryUsage.at, new Date(query.to)),
              ),
            );
          const runRows = await tx
            .select({
              id: discoveryRun.id,
              unit: discoveryRun.policy,
              budget: discoveryRun.budget,
              used: discoveryRun.used,
              createdAt: discoveryRun.createdAt,
            })
            .from(discoveryRun)
            .where(eq(discoveryRun.businessId, businessId));
          const priced = usage.filter(
            (u) => u.providerCost?.estimatedUsd != null,
          );
          const reviews = usage.filter(
            (u) => u.kind === "review" && u.outcome === "succeeded",
          );
          const matchedReviews = new Set(
            evidence.observations.map((o) => o.id),
          );
          metric(
            "fit_review_yield",
            "Source reviews retaining a match",
            "discovery",
            reviews.filter((u) => matchedReviews.has(u.id)).length,
            reviews.length,
            "Successful review operations retaining a sourced match / all successful review operations reserved in this interval. This is model-assisted selection yield, not independently reviewed accuracy or unique-prospect volume.",
            "Operation-reserved cohort; recorded review outcome",
            "reviews",
          );
          const searchResults = usage.filter(
            (u) => u.kind === "search" && u.returnedResults !== null,
          );
          const searchOperations = usage.filter((u) => u.kind === "search");
          const searchCountKnown =
            searchResults.length > 0 || searchOperations.length === 0;
          metric(
            "raw_search_results",
            "Recorded search results before consolidation",
            "discovery",
            searchCountKnown
              ? searchResults.reduce(
                  (sum, u) => sum + (u.returnedResults ?? 0),
                  0,
                )
              : null,
            null,
            `Raw provider search-result appearances across ${searchResults.length} of ${usage.filter((u) => u.kind === "search").length} search operations with a recorded result count. Repeated appearances are not unique prospects; unrecorded counts remain outside this subtotal.`,
            "Search operation-reserved cohort",
            "appearances",
            searchCountKnown ? "recorded" : "unavailable",
          );
          metric(
            "named_buyer_routes",
            "Named buyer contact routes",
            "discovery",
            current.filter((p) => p.contactStatus === "buyer_contact").length,
            prospects.length,
            "Current explicit named purchasing/owner role WITH its attributed usable contact route / unique observed prospects. Named-role evidence without a route remains separate.",
            discoveryCohort,
            "prospects",
          );
          metric(
            "discovery_estimated_usd",
            "Recorded Exa estimate (USD)",
            "cost",
            priced.length
              ? priced.reduce(
                  (sum, u) => sum + (u.providerCost?.estimatedUsd ?? 0),
                  0,
                )
              : null,
            null,
            `Sum of provider-returned estimates for ${priced.length} of ${usage.filter((u) => u.kind !== "review").length} retrieval operations; no invoice, FX conversion or AI/operator expense is implied. Missing estimates are unknown, not free.`,
            "Operation reserved time in interval; immutable operation identity",
            "USD",
            priced.length ? "estimated" : "unavailable",
          );
          metric(
            "discovery_priced_operations",
            "Retrieval estimate coverage",
            "cost",
            priced.length,
            usage.filter((u) => u.kind !== "review").length,
            "Retrieval operations carrying a provider estimate / search and contents operations. Reviews are AI work, not retrieval charges.",
            "Operation reserved time in interval",
            "operations",
          );
          for (const unit of new Set(
            runRows.map((r) => r.unit.allowanceUnit),
          )) {
            const ids = new Set(
              runRows
                .filter((r) => r.unit.allowanceUnit === unit)
                .map((r) => r.id),
            );
            metric(
              `allowance_${unit}`,
              `Discovery allowance used (${unit})`,
              "cost",
              usage
                .filter((u) => ids.has(u.runId))
                .reduce((sum, u) => sum + u.units, 0),
              null,
              "Reserved allowance units across all operation outcomes, including uncertain or failed work. This is capacity, not money.",
              "Operation reserved time in interval",
              unit,
            );
            const runs = runRows.filter(
              (r) => r.unit.allowanceUnit === unit && inWindow(r.createdAt),
            );
            metric(
              `run_remaining_${unit}`,
              `Remaining run budgets (${unit})`,
              "cost",
              runs.reduce((sum, r) => sum + r.budget - r.used, 0),
              null,
              "Current unused authorized run budgets for runs created in the interval. This is not the subscription's unallocated capacity.",
              "Run-created cohort; current remaining budgets",
              unit,
            );
          }
          for (const o of observed)
            items.push({
              id: `discovery:${o.id}`,
              category: "discovery",
              entityId: o.prospectId,
              opportunityId: null,
              channel: null,
              kind: "source_observation",
              state: o.outcome,
              at: o.checkedAt,
              sourceIds: [o.id, o.runId],
              version: null,
              link: `/businesses/${businessId}/discovery`,
              note: "Immutable source observation; current fit/contact/request state is evaluated separately. Inspect source dates and uncertainty in Discovery.",
            });
          const sales = await collectSalesReport(
            tx,
            identity,
            businessId,
            at,
            inWindow,
            metric,
            items,
          );
          await collectCommunicationReport(
            tx,
            businessId,
            at,
            inWindow,
            sales,
            metric,
            items,
          );
          const currentRole = await requireCapability(
            tx,
            identity,
            businessId,
            "sales.work",
          );
          await requireSalesSession(tx, identity, clock.now(), currentRole);
          const selected = items
            .filter(
              (i) => query.category === "all" || i.category === query.category,
            )
            .sort(
              (a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id),
            );
          const page = selected.slice(query.offset, query.offset + query.limit);
          return businessReportSchema.parse({
            businessId,
            asOf: clock.now().toISOString(),
            from: query.from,
            to: query.to,
            coverage: [
              "Complete retained Business records; no detail page limit is applied to aggregates.",
              "Current state is evaluated at report generation. Both selected interval endpoints are inclusive; adjacent interval reports can overlap at their shared endpoint.",
              `Discovery earliest retained check: ${evidence.observations.map((o) => new Date(o.checkedAt).toISOString()).sort()[0] ?? "unavailable (no observations)"}. Inquiry earliest retained occurrence: ${sales.messages.map((m) => new Date(m.message.content.occurredAt).toISOString()).sort()[0] ?? "unavailable (no captured messages)"}. Earliest retained times are not completeness guarantees.`,
              "Retention cutoff: unavailable as a single report-wide measurement. Canonical records follow their source contracts; private artifacts can expire under separate approved policies. Historical absence is not proof that no activity occurred.",
              "Capture coverage includes selected supported or explicitly imported channels only. Ignored, unsupported and uncaptured traffic is outside inquiry counts. Source-observed request status is not a new live source check.",
              "Response coverage includes only recorded submissions or supported manual replies with established chronology after cohort engagement. Meta uses its original reservation as a conservative timing lower bound, never a later reconciliation time. Excluded uncertain timing does not establish absence of all responses.",
              "Source details reauthorize and regenerate on every page; concurrent corrections can move rows between pages. Current states are not historical snapshots at the interval end.",
              "Reports preserve retained facts independently of current paid discovery reach or cancellation. Exports and offboarding use their own Owner/Admin, current-MFA, policy, source-rights and expiry checks; a report grants no download, cleanup or commercial capability.",
              "Operator setup/support/sales expense is a separate privileged ledger. This report never includes global operator costs or customer-paid Meta in platform spend.",
            ],
            metrics,
            details: {
              total: selected.length,
              offset: query.offset,
              limit: query.limit,
              nextOffset:
                query.offset + page.length < selected.length
                  ? query.offset + page.length
                  : null,
              items: page,
            },
          });
        },
        { at: clock.now(), lock: true },
      );
    },
  };
}
