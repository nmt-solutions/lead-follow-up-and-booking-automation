import { z } from "zod";
import { liabilityReportSchema, taxPeriodWorkspaceSchema } from "./tax-periods";
import { taxFilingStatusSchema } from "./tax-filing-status";

export const filingNote = z.string().trim().min(1).max(1000);
export const approvedReportIdentitySchema = z.strictObject({
  reportId: z.uuid(),
  periodId: z.uuid(),
  revision: z.number().int().positive(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  approvalId: z.uuid(),
});
export const filingExportSchema = approvedReportIdentitySchema.extend({
  requestKey: z.uuid(),
  note: filingNote,
});
export type FilingExportInput = z.infer<typeof filingExportSchema>;
export const filingExportViewSchema = z.object({
  id: z.uuid(),
  report: liabilityReportSchema,
  format: z.literal("tax_accounting_filing_v1"),
  filed: z.literal(false),
  paid: z.literal(false),
  actorId: z.string(),
  actorName: z.string(),
  at: z.string(),
  note: z.string(),
});
export type FilingExport = z.infer<typeof filingExportViewSchema>;

const version = z.number().int().min(0).max(2147483646);
const minor = z.string().regex(/^(0|[1-9][0-9]{0,59})$/);
const signedMinor = z.string().regex(/^-?(0|[1-9][0-9]{0,59})$/);
const label = z.string().trim().min(1).max(200);
export const filingPolicyDefinitionSchema = z
  .strictObject({
    adapter: z.literal("manual_evidence_v1"),
    authorityAccount: label,
    fundingAccount: label,
    returnType: label,
    filingRequired: z.boolean(),
    paymentRequired: z.boolean(),
    effectiveFrom: z.iso.datetime(),
    effectiveUntil: z.iso.datetime().nullable(),
    retention: z.strictObject({
      disposition: z.literal("protected_history"),
      policyReference: filingNote,
    }),
    evidence: z.array(filingNote).min(1).max(30),
  })
  .refine(
    (v) =>
      (v.filingRequired || v.paymentRequired) &&
      (!v.effectiveUntil ||
        new Date(v.effectiveUntil) > new Date(v.effectiveFrom)),
  );
export type FilingPolicyDefinition = z.infer<
  typeof filingPolicyDefinitionSchema
>;
export const saveFilingPolicySchema = z.strictObject({
  requestKey: z.uuid(),
  obligationId: z.uuid(),
  expectedVersion: version,
  definition: filingPolicyDefinitionSchema,
  note: filingNote,
});
export const decideFilingPolicySchema = z.strictObject({
  requestKey: z.uuid(),
  policyId: z.uuid(),
  expectedVersion: version,
  outcome: z.enum(["approved", "withdrawn"]),
  note: filingNote,
});
export const prepareFilingSchema = approvedReportIdentitySchema
  .extend({
    requestKey: z.uuid(),
    policyId: z.uuid(),
    kind: z.enum(["submission", "remittance"]),
    amountMinor: signedMinor,
    amendmentOf: z.uuid().nullable(),
    supersedesId: z.uuid().nullable().default(null),
    note: filingNote,
  })
  .refine((v) => v.kind === "submission" || !v.amountMinor.startsWith("-"));
const actionBase = {
  requestKey: z.uuid(),
  intentId: z.uuid(),
  expectedVersion: version,
  note: filingNote,
};
export const filingActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...actionBase,
    kind: z.literal("approve"),
    basisDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  z.strictObject({
    ...actionBase,
    kind: z.literal("attempt"),
    outcome: z.enum(["pending", "unknown", "failed"]),
    reference: label,
    occurredAt: z.iso.datetime(),
  }),
  z.strictObject({
    ...actionBase,
    kind: z.literal("acknowledge"),
    evidenceId: z.uuid(),
  }),
  z.strictObject({
    ...actionBase,
    kind: z.literal("confirm"),
    acknowledgementId: z.uuid(),
  }),
  z.strictObject({
    ...actionBase,
    kind: z.literal("raise_issue"),
    evidenceId: z.uuid(),
  }),
  z.strictObject({
    ...actionBase,
    kind: z.literal("resolve_issue"),
    issueId: z.uuid(),
    evidenceId: z.uuid(),
  }),
  z.strictObject({
    ...actionBase,
    kind: z.literal("supersede"),
    evidenceId: z.uuid(),
  }),
]);
export type SaveFilingPolicy = z.infer<typeof saveFilingPolicySchema>;
export type DecideFilingPolicy = z.infer<typeof decideFilingPolicySchema>;
export type PrepareFiling = z.infer<typeof prepareFilingSchema>;
export type FilingAction = z.infer<typeof filingActionSchema>;
const attribution = {
  actorId: z.string(),
  actorName: z.string(),
  at: z.string(),
  note: z.string(),
};
export const filingPolicyViewSchema = z.object({
  id: z.uuid(),
  obligationId: z.uuid(),
  version,
  definition: filingPolicyDefinitionSchema,
  ...attribution,
});
export type FilingPolicy = z.infer<typeof filingPolicyViewSchema>;
export const filingPolicyDecisionSchema = z.object({
  id: z.uuid(),
  policyId: z.uuid(),
  version,
  outcome: z.enum(["approved", "withdrawn"]),
  ...attribution,
});
export const filingTargetSchema = z.object({
  reportId: z.uuid(),
  periodId: z.uuid(),
  revision: version,
  digest: z.string(),
  approvalId: z.uuid(),
  obligationId: z.uuid(),
  obligationKey: z.string(),
  registration: z.string(),
  jurisdiction: z.string(),
  mode: z.enum(["fixture", "live"]),
  currency: z.enum(["INR", "USD"]),
  authorityAccount: z.string(),
  fundingAccount: z.string(),
  returnType: z.string(),
  start: z.string(),
  end: z.string(),
});
export type FilingTarget = z.infer<typeof filingTargetSchema>;
const filingEvidenceTargetSchema = filingTargetSchema
  .extend({ currency: z.string().regex(/^[A-Z]{3}$/) })
  .nullable();
export const storeFilingEvidenceSchema = z.strictObject({
  requestKey: z.uuid(),
  reportId: z.uuid(),
  target: filingEvidenceTargetSchema,
  kind: z.enum([
    "authority_acknowledgement",
    "bank_confirmation",
    "supporting",
  ]),
  result: z.enum([
    "filed",
    "accepted_for_processing",
    "settled",
    "failed",
    "unknown",
    "no_effect",
  ]),
  reference: label,
  amountMinor: signedMinor,
  occurredAt: z.iso.datetime(),
  name: label.refine((v) => !/[\x00-\x1f\x7f/\\]/.test(v)),
  contentType: z.enum([
    "text/plain",
    "application/pdf",
    "image/png",
    "image/jpeg",
  ]),
  bytesBase64: z
    .string()
    .min(4)
    .max(2796204)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  note: filingNote,
});
export type StoreFilingEvidence = z.infer<typeof storeFilingEvidenceSchema>;
export const filingEvidenceViewSchema = z.object({
  id: z.uuid(),
  reportId: z.uuid(),
  target: filingEvidenceTargetSchema,
  kind: z.enum([
    "authority_acknowledgement",
    "bank_confirmation",
    "supporting",
  ]),
  result: z.enum([
    "filed",
    "accepted_for_processing",
    "settled",
    "failed",
    "unknown",
    "no_effect",
  ]),
  reference: z.string(),
  amountMinor: signedMinor,
  occurredAt: z.string(),
  name: z.string(),
  contentType: z.string(),
  sha256: z.string(),
  size: z.number(),
  verification: z.literal("operator_entered_original"),
  retention: z.object({
    disposition: z.literal("protected_history"),
    policyReference: z.string(),
  }),
  ...attribution,
});
export type FilingEvidence = z.infer<typeof filingEvidenceViewSchema>;
export const filingEventViewSchema = z.object({
  id: z.uuid(),
  intentId: z.uuid(),
  version,
  kind: z.string(),
  detail: z.record(z.string(), z.unknown()),
  ...attribution,
});
export type FilingEvent = z.infer<typeof filingEventViewSchema>;
export const filingIntentViewSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["submission", "remittance"]),
  target: filingTargetSchema,
  report: liabilityReportSchema,
  policy: filingPolicyViewSchema,
  policyDecisionId: z.uuid(),
  amountMinor: signedMinor,
  amendmentOf: z.uuid().nullable(),
  supersedesId: z.uuid().nullable(),
  ...attribution,
  version,
  status: z.string(),
  filed: z.boolean(),
  paid: z.boolean(),
  verification: z.literal("operator_evidence_review"),
  events: z.array(filingEventViewSchema),
  unresolvedIssueIds: z.array(z.uuid()),
  basisDigest: z.string(),
  currentBasisDigest: z.string(),
  reviewRequired: z.boolean(),
  authorizationCurrent: z.boolean(),
});
export type FilingIntent = z.infer<typeof filingIntentViewSchema>;
export const remittanceReconciliationSchema =
  approvedReportIdentitySchema.extend({
    requestKey: z.uuid(),
    allocationId: z.uuid(),
    expectedVersion: version,
    expectedReportId: z.uuid(),
    policyId: z.uuid(),
    note: filingNote,
  });
export type RemittanceReconciliation = z.infer<
  typeof remittanceReconciliationSchema
>;
export const filingExpenseSchema = z.strictObject({
  requestKey: z.uuid(),
  evidenceId: z.uuid(),
  quantity: z.number().int().positive().max(1e12),
  unit: z.enum(["filing", "document", "service", "minute", "hour"]),
  funding: z.enum(["cash", "existing_subscription", "unknown"]),
  retentionSeconds: z.number().int().min(60).max(2147483647),
  note: filingNote.max(300),
});
export type FilingExpense = z.infer<typeof filingExpenseSchema>;
const allocationViewSchema = z.object({
  id: z.uuid(),
  intentId: z.uuid(),
  confirmationId: z.uuid(),
  evidenceId: z.uuid(),
  reportId: z.uuid(),
  currentReportId: z.uuid(),
  amountMinor: minor,
  currency: z.string(),
  ...attribution,
});
export const taxFilingWorkspaceSchema = taxPeriodWorkspaceSchema.extend({
  periods: z.array(
    taxPeriodWorkspaceSchema.shape.periods.element.extend({
      ...taxFilingStatusSchema.shape,
      readiness: z.enum(["configured", "setup_required"]),
    }),
  ),
  policies: z.array(filingPolicyViewSchema),
  policyDecisions: z.array(filingPolicyDecisionSchema),
  intents: z.array(filingIntentViewSchema),
  evidence: z.array(filingEvidenceViewSchema),
  exports: z.array(filingExportViewSchema),
  configured: z.array(z.string()),
  allocations: z.array(allocationViewSchema),
  allocationReviews: z.array(
    z.object({
      id: z.uuid(),
      allocationId: z.uuid(),
      reportId: z.uuid(),
      policyId: z.uuid(),
      policyDecisionId: z.uuid(),
      reportApprovalId: z.uuid(),
      version,
      ...attribution,
    }),
  ),
});
export type TaxFilingWorkspace = z.infer<typeof taxFilingWorkspaceSchema>;
