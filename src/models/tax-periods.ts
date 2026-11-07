import { z } from "zod";
import { documentSnapshotSchema } from "./seller-documents";
import { taxModeSchema, taxCurrencySchema, taxCalculationSchema } from "./tax";

const note = z.string().trim().min(1).max(1000);
const label = z.string().trim().min(1).max(200);
const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/);
const version = z.number().int().min(0).max(2147483646);
const evidence = z.array(note).min(1).max(30);
const window = {
  effectiveFrom: z.iso.datetime(),
  effectiveUntil: z.iso.datetime().nullable(),
};
const validWindow = (v: {
  effectiveFrom: string;
  effectiveUntil: string | null;
}) =>
  !v.effectiveUntil || new Date(v.effectiveUntil) > new Date(v.effectiveFrom);
export const obligationDefinitionSchema = z
  .strictObject({
    mode: taxModeSchema,
    name: label,
    jurisdiction: label,
    timeZone: label.refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }),
    currency: taxCurrencySchema,
    ...window,
    registration: z
      .strictObject({
        key,
        identifier: label,
        status: z.enum(["registered", "not_required"]),
        ...window,
        evidence,
      })
      .refine(validWindow),
    basis: z.literal("document_issue_date"),
    unissuedCharges: z.enum(["require_invoice", "review_exclusion"]),
    preparerIds: z.array(label).min(1).max(100),
    reviewerIds: z.array(label).min(1).max(100),
    distinctReviewer: z.boolean(),
    evidence,
  })
  .refine(validWindow);
export type ObligationDefinition = z.infer<typeof obligationDefinitionSchema>;
export const saveObligationSchema = z.strictObject({
  requestKey: z.uuid(),
  key,
  expectedVersion: version,
  definition: obligationDefinitionSchema,
  note,
});
export const decideObligationSchema = z.strictObject({
  requestKey: z.uuid(),
  revisionId: z.uuid(),
  expectedVersion: version,
  outcome: z.enum(["approved", "withdrawn"]),
  note,
});
export const openTaxPeriodSchema = z
  .strictObject({
    requestKey: z.uuid(),
    obligationId: z.uuid(),
    supersedesId: z.uuid().nullable().default(null),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    dueAt: z.iso.datetime(),
    evidence,
    reminders: z.array(z.strictObject({ key, at: z.iso.datetime() })).max(30),
    note,
  })
  .refine(
    (v) =>
      v.startDate < v.endDate &&
      new Set(v.reminders.map((r) => r.key)).size === v.reminders.length &&
      new Set(v.reminders.map((r) => new Date(r.at).getTime())).size ===
        v.reminders.length,
  );
export const prepareTaxReportSchema = z.strictObject({
  requestKey: z.uuid(),
  periodId: z.uuid(),
  expectedRevision: version,
  cutoff: z.iso.datetime(),
  note,
});
export const taxReportActionSchema = z.strictObject({
  requestKey: z.uuid(),
  reportId: z.uuid(),
  expectedVersion: version,
  kind: z.enum(["review", "raise_issue", "resolve_issue", "approve"]),
  issueId: z.string().min(1).max(240).nullable(),
  note,
  evidence,
});
export type SaveObligation = z.infer<typeof saveObligationSchema>;
export type DecideObligation = z.infer<typeof decideObligationSchema>;
export type OpenTaxPeriod = z.infer<typeof openTaxPeriodSchema>;
export type PrepareTaxReport = z.infer<typeof prepareTaxReportSchema>;
export type TaxReportActionInput = z.infer<typeof taxReportActionSchema>;
const attribution = {
  actorId: z.string(),
  actorName: z.string(),
  at: z.iso.datetime(),
  note: z.string(),
};
export const obligationRevisionSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  version,
  definition: obligationDefinitionSchema,
  ...attribution,
});
export const obligationDecisionSchema = z.object({
  id: z.uuid(),
  revisionId: z.uuid(),
  version,
  outcome: z.enum(["approved", "withdrawn"]),
  ...attribution,
});
export const reportingPeriodSchema = z.object({
  id: z.uuid(),
  obligationId: z.uuid(),
  supersedesId: z.uuid().nullable(),
  obligationKey: z.string(),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  timeZone: z.string(),
  dueAt: z.iso.datetime(),
  evidence: z.array(z.string()),
  reminders: z.array(z.object({ key: z.string(), at: z.iso.datetime() })),
  ...attribution,
});
export type ReportingPeriod = z.infer<typeof reportingPeriodSchema>;
export type ObligationRevision = z.infer<typeof obligationRevisionSchema>;
export type ObligationDecision = z.infer<typeof obligationDecisionSchema>;
export const reportIssueSchema = z.object({
  id: z.string(),
  code: z.string(),
  sourceId: z.string().nullable(),
  required: z.boolean(),
  resolvable: z.boolean(),
});
export type ReportIssue = z.infer<typeof reportIssueSchema>;
const minor = z.string().regex(/^-?(0|[1-9][0-9]{0,59})$/);
const totals = z.object({
  netMinor: minor,
  taxMinor: minor,
  totalMinor: minor,
});
export const liabilitySnapshotSchema = z.object({
  version: z.literal(1),
  period: reportingPeriodSchema,
  obligation: obligationRevisionSchema,
  cutoff: z.iso.datetime(),
  sourceFingerprint: z.string(),
  configurationFingerprint: z.string(),
  currency: taxCurrencySchema,
  basis: z.literal("signed_original_components_v1"),
  totals,
  totalsKnown: z.boolean(),
  components: z.array(
    z.object({
      ruleRevisionId: z.string(),
      jurisdiction: z.string(),
      registration: z.string(),
      treatment: z.string(),
      name: z.string(),
      amountMinor: minor,
    }),
  ),
  sources: z.array(
    z.object({
      id: z.string(),
      businessId: z.string(),
      periodId: z.string(),
      kind: z.enum(["invoice", "credit_note", "captured_charge"]),
      number: z.string().nullable(),
      originalId: z.string().nullable(),
      original: documentSnapshotSchema.shape.original,
      adjustment: documentSnapshotSchema.shape.adjustment,
      coveredByDocumentId: z.string().nullable(),
      at: z.string().nullable(),
      currency: z.string(),
      included: z.boolean(),
      reason: z.string(),
      artifactState: z.string().nullable(),
      lines: taxCalculationSchema.shape.lines,
      totals: totals.nullable(),
      adjustmentId: z.string().nullable(),
      nativePaymentId: z.string().nullable(),
    }),
  ),
  adjustments: z.array(
    z.object({
      id: z.string(),
      invoiceId: z.string(),
      nativeId: z.string(),
      source: z.string(),
      at: z.string(),
      actualMinor: minor,
      currency: z.string(),
      originalTax: z.unknown(),
      allocation: z.unknown(),
      creditApplicable: z.boolean(),
      creditDocumentId: z.string().nullable(),
      creditMinor: minor.nullable(),
      approvedCredit: z.unknown(),
      uncreditedDifferenceMinor: minor.nullable(),
      taxEffect: z.literal("linked_credit_only"),
    }),
  ),
  issues: z.array(reportIssueSchema),
});
export type LiabilitySnapshot = z.infer<typeof liabilitySnapshotSchema>;
export const reportActionViewSchema = z.object({
  id: z.uuid(),
  version,
  kind: z.string(),
  detail: z.object({
    issueId: z.string().nullable(),
    evidence: z.array(z.string()),
  }),
  ...attribution,
  actorId: z.string().nullable(),
});
export const liabilityReportSchema = z.object({
  id: z.uuid(),
  periodId: z.uuid(),
  revision: version,
  digest: z.string(),
  snapshot: liabilitySnapshotSchema,
  digestAlgorithm: z.literal("sha256_sorted_json_v1"),
  ...attribution,
  status: z.enum([
    "prepared",
    "in_review",
    "approved",
    "review_required",
    "superseded",
  ]),
  current: z.boolean(),
  filed: z.literal(false),
  paid: z.literal(false),
  actions: z.array(reportActionViewSchema),
  unresolved: z.array(reportIssueSchema),
});
export type LiabilityReport = z.infer<typeof liabilityReportSchema>;
export const taxReminderSchema = z.object({
  id: z.uuid(),
  periodId: z.uuid(),
  stage: z.string(),
  stageAt: z.string(),
  at: z.string(),
  channel: z.literal("in_app"),
  status: z.literal("available"),
  current: z.boolean(),
  source: z.object({
    obligationId: z.string(),
    decisionId: z.string(),
    reportId: z.string().nullable(),
    reportDigest: z.string().nullable(),
    actionVersion: z.number(),
    status: z.string(),
  }),
});
export type TaxReminder = z.infer<typeof taxReminderSchema>;
export const taxPeriodWorkspaceSchema = z.object({
  actorId: z.string(),
  operators: z.array(z.object({ id: z.string(), name: z.string() })),
  obligations: z.array(obligationRevisionSchema),
  decisions: z.array(obligationDecisionSchema),
  periods: z.array(
    z.object({
      period: reportingPeriodSchema,
      report: liabilityReportSchema.nullable(),
      reports: z.array(liabilityReportSchema),
      status: z.string(),
      overdue: z.boolean(),
    }),
  ),
  reminders: z.array(taxReminderSchema),
});
export type TaxPeriodWorkspace = z.infer<typeof taxPeriodWorkspaceSchema>;
export const taxPeriodScreenSchema = z.object({
  workspace: taxPeriodWorkspaceSchema,
  emailPreference: z
    .object({
      purpose: z.literal("tax_period"),
      enabled: z.boolean(),
      version: z.number(),
    })
    .nullable(),
});
export type TaxPeriodScreen = z.infer<typeof taxPeriodScreenSchema>;
