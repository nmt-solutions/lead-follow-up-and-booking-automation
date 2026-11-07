import { z } from "zod";
import { documentSnapshotSchema } from "../models/seller-documents";
import { taxCalculationSchema } from "../models/tax";
import type {
  ObligationRevision,
  ReportingPeriod,
  LiabilitySnapshot,
  ReportIssue,
} from "../models/tax-periods";

const totals = z.object({
  netMinor: z.string().regex(/^\d+$/),
  taxMinor: z.string().regex(/^\d+$/),
  totalMinor: z.string().regex(/^\d+$/),
});
const document = z.object({
  id: z.string(),
  businessId: z.string(),
  periodId: z.string(),
  originalId: z.string().nullable(),
  adjustmentId: z.string().nullable(),
  kind: z.enum(["invoice", "credit_note"]),
  number: z.string(),
  at: z.string(),
  artifactState: z.string(),
  snapshot: z.object({
    lines: taxCalculationSchema.shape.lines,
    totals,
    currency: z.string(),
    source: z.object({ paymentId: z.string() }),
    adjustment: documentSnapshotSchema.shape.adjustment,
    original: documentSnapshotSchema.shape.original,
  }),
});
export const taxReportingSourcesSchema = z.object({
  fingerprint: z.string(),
  documents: z.array(document),
  charges: z.array(
    z.object({
      id: z.string(),
      businessId: z.string(),
      paymentId: z.string(),
      at: z.string().nullable(),
      dateEvidence: z.string(),
      currency: z.string(),
      lines: taxCalculationSchema.shape.lines,
      totals: totals.nullable(),
      invoiceId: z.string().nullable(),
    }),
  ),
  adjustments: z.array(
    z.object({
      id: z.string(),
      invoiceId: z.string(),
      at: z.string(),
      effect: z.object({
        source: z.string(),
        nativeId: z.string(),
        actualMinor: z.string().regex(/^\d+$/),
        currency: z.string(),
        originalTax: z.unknown(),
        allocation: z.unknown(),
        creditApplicable: z.boolean(),
      }),
      creditDocumentId: z.string().nullable(),
      creditMinor: z.string().nullable(),
      approvedCredit: z.unknown(),
    }),
  ),
});
export type TaxReportingSources = z.infer<typeof taxReportingSourcesSchema>;

/** Original signed components only; confirmed cash is contextual and never subtracted again. */
export function aggregateTaxLiability(
  obligation: ObligationRevision,
  period: ReportingPeriod,
  population: TaxReportingSources,
  cutoff: string,
  configurationFingerprint: string,
): LiabilitySnapshot {
  const config = obligation.definition;
  const issues: ReportIssue[] = [],
    sources: LiabilitySnapshot["sources"] = [],
    adjustments: LiabilitySnapshot["adjustments"] = [];
  const components = new Map<string, LiabilitySnapshot["components"][number]>();
  let net = 0n,
    tax = 0n,
    gross = 0n;
  const issue = (code: string, sourceId: string | null, resolvable = false) =>
    issues.push({
      id: `${code}:${sourceId ?? "period"}`,
      code,
      sourceId,
      required: true,
      resolvable,
    });
  const inside = (at: string) =>
    new Date(at) >= new Date(period.start) &&
    new Date(at) < new Date(period.end);
  for (const d of population.documents) {
    const lines = d.snapshot.lines.filter(
      (l) => l.rule.revision.rule.jurisdiction.code === config.jurisdiction,
    );
    let reason = "included";
    if (!inside(d.at)) reason = "outside_period_original_context";
    else if (new Date(d.at) > new Date(cutoff)) reason = "after_cutoff";
    else if (!lines.length) reason = "other_jurisdiction";
    else if (d.snapshot.currency !== config.currency)
      reason = "reporting_currency_evidence_required";
    else if (
      lines.some(
        (l) =>
          l.rule.revision.rule.registration.identifier !==
          config.registration.identifier,
      )
    )
      reason = "registration_coverage_required";
    if (
      [
        "reporting_currency_evidence_required",
        "registration_coverage_required",
      ].includes(reason)
    )
      issue(reason, d.id);
    if (reason === "after_cutoff") issue("late_source_after_cutoff", d.id);
    if (reason === "included" && d.kind === "credit_note") {
      const original = population.documents.find(
        (i) => i.id === d.originalId && i.kind === "invoice",
      );
      if (!original || original.snapshot.currency !== d.snapshot.currency) {
        reason = "original_invoice_evidence_required";
        issue(reason, d.id);
      }
    }
    const included = reason === "included";
    sources.push({
      id: d.id,
      businessId: d.businessId,
      periodId: d.periodId,
      kind: d.kind,
      number: d.number,
      originalId: d.originalId,
      original: d.snapshot.original,
      adjustment: d.snapshot.adjustment,
      coveredByDocumentId: null,
      at: d.at,
      currency: d.snapshot.currency,
      included,
      reason,
      artifactState: d.artifactState,
      lines: d.snapshot.lines,
      totals: d.snapshot.totals,
      adjustmentId: d.adjustmentId,
      nativePaymentId: d.snapshot.source.paymentId,
    });
    if (!included) continue;
    if (d.artifactState !== "ready")
      issue("numbered_document_artifact_unavailable", d.id, true);
    const sign = d.kind === "invoice" ? 1n : -1n;
    for (const l of lines) {
      net += sign * BigInt(l.netMinor);
      tax += sign * BigInt(l.taxMinor);
      gross += sign * BigInt(l.totalMinor);
      for (const c of l.components) {
        const rule = l.rule.revision,
          key = JSON.stringify([rule.id, c.name]);
        const previous = components.get(key);
        components.set(key, {
          ruleRevisionId: rule.id,
          jurisdiction: rule.rule.jurisdiction.code,
          registration: rule.rule.registration.identifier,
          treatment: rule.rule.treatment,
          name: c.name,
          amountMinor: String(
            BigInt(previous?.amountMinor ?? "0") + sign * BigInt(c.amountMinor),
          ),
        });
      }
    }
  }
  for (const c of population.charges) {
    if (
      !c.lines.some(
        (l) => l.rule.revision.rule.jurisdiction.code === config.jurisdiction,
      )
    )
      continue;
    const code = c.invoiceId
      ? "represented_by_permanent_invoice"
      : c.dateEvidence === "missing"
        ? "capture_date_evidence_required"
        : "captured_charge_without_invoice";
    sources.push({
      id: c.id,
      businessId: c.businessId,
      periodId: c.id,
      kind: "captured_charge",
      number: null,
      originalId: null,
      original: null,
      adjustment: null,
      coveredByDocumentId: c.invoiceId,
      at: c.at,
      currency: c.currency,
      included: false,
      reason: code,
      artifactState: null,
      lines: c.lines,
      totals: c.totals,
      adjustmentId: null,
      nativePaymentId: c.paymentId,
    });
    if (c.invoiceId) continue;
    issue(
      code,
      c.id,
      code === "captured_charge_without_invoice" &&
        config.unissuedCharges === "review_exclusion",
    );
  }
  const seen = new Set<string>();
  for (const a of population.adjustments) {
    if (
      !a.effect.originalTax ||
      (!sources.some((s) => s.id === a.invoiceId) &&
        !population.documents.some(
          (d) =>
            d.id === a.invoiceId &&
            d.snapshot.lines.some(
              (l) =>
                l.rule.revision.rule.jurisdiction.code === config.jurisdiction,
            ),
        ))
    )
      continue;
    if (new Date(a.at) > new Date(cutoff)) {
      issue("late_adjustment_after_cutoff", a.id);
      continue;
    }
    const nativeKey = `${a.effect.source}:${a.effect.nativeId}:${a.invoiceId}`;
    if (seen.has(nativeKey)) {
      issue("duplicate_native_adjustment", a.id);
      continue;
    }
    seen.add(nativeKey);
    const creditMinor = a.creditMinor;
    adjustments.push({
      id: a.id,
      invoiceId: a.invoiceId,
      nativeId: a.effect.nativeId,
      source: a.effect.source,
      at: a.at,
      actualMinor: a.effect.actualMinor,
      currency: a.effect.currency,
      originalTax: a.effect.originalTax,
      allocation: a.effect.allocation,
      creditApplicable: a.effect.creditApplicable,
      creditDocumentId: a.creditDocumentId,
      creditMinor,
      approvedCredit: a.approvedCredit,
      uncreditedDifferenceMinor:
        creditMinor === null
          ? null
          : String(BigInt(a.effect.actualMinor) - BigInt(creditMinor)),
      taxEffect: "linked_credit_only",
    });
    if (a.effect.creditApplicable && !a.creditDocumentId)
      issue("confirmed_adjustment_without_permanent_credit", a.id);
  }
  return {
    version: 1,
    period,
    obligation,
    cutoff,
    sourceFingerprint: population.fingerprint,
    configurationFingerprint,
    currency: config.currency,
    basis: "signed_original_components_v1",
    totals: {
      netMinor: String(net),
      taxMinor: String(tax),
      totalMinor: String(gross),
    },
    totalsKnown: !issues.some((i) => !i.resolvable),
    components: [...components.values()],
    sources,
    adjustments,
    issues,
  };
}
