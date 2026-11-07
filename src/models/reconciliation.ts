import { z } from "zod";

export const reconciliationPeriodSchema = z
  .strictObject({
    from: z.iso.datetime(),
    until: z.iso.datetime(),
  })
  .refine(
    (v) =>
      new Date(v.from) < new Date(v.until) &&
      new Date(v.until).getTime() - new Date(v.from).getTime() <=
        366 * 86400000,
  );
export const reconciliationMinor = z.string().regex(/^(0|[1-9][0-9]{0,39})$/);
export const reconciliationMoney = z.strictObject({
  currency: z.enum(["INR", "USD"]),
  precision: z.literal(2),
  minor: reconciliationMinor,
});
const totals = z.object({
  netMinor: reconciliationMinor,
  taxMinor: reconciliationMinor,
  totalMinor: reconciliationMinor,
});
export const reconciliationSourceSchema = z.object({
  periodId: z.uuid(),
  actionId: z.uuid(),
  businessId: z.uuid(),
  businessName: z.string(),
  provider: z.string(),
  account: z.string(),
  mode: z.enum(["fixture", "test", "live"]),
  paymentId: z.string(),
  nativeInvoiceId: z.string().nullable(),
  orderId: z.string(),
  subscriptionId: z.string().nullable(),
  customerId: z.string().nullable(),
  quoteId: z.uuid(),
  taxCalculationId: z.uuid(),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  taxLines: z.array(
    z.object({
      id: z.string(),
      netMinor: reconciliationMinor,
      taxMinor: reconciliationMinor,
      totalMinor: reconciliationMinor,
      components: z.array(
        z.object({ name: z.string(), amountMinor: reconciliationMinor }),
      ),
      ruleId: z.uuid(),
      approvalId: z.uuid(),
    }),
  ),
  kind: z.enum(["initial", "renewal", "reach_delta"]),
  paidAt: z.iso.datetime(),
  currency: z.enum(["INR", "USD"]),
  precision: z.literal(2),
  totals,
  baseAmountMinor: reconciliationMinor.nullable(),
  baseCurrency: z.literal("INR").nullable(),
  feeMinor: reconciliationMinor.nullable(),
  feeTaxMinor: reconciliationMinor.nullable(),
  feeCurrency: z.enum(["INR", "USD"]).nullable(),
  invoice: z
    .object({ id: z.uuid(), number: z.string(), sha256: z.string(), totals })
    .nullable(),
  credits: z.array(
    z.object({ id: z.uuid(), number: z.string(), sha256: z.string(), totals }),
  ),
  effects: z.array(
    z.object({
      id: z.uuid(),
      caseId: z.uuid(),
      source: z.enum(["refund", "dispute"]),
      nativeId: z.string(),
      actualMinor: reconciliationMinor,
      currency: z.enum(["INR", "USD"]),
      at: z.iso.datetime(),
      allocation: z.unknown(),
      originalTax: z.unknown(),
      approvedCredit: z
        .object({
          actualMinor: reconciliationMinor,
          uncreditedDifferenceMinor: reconciliationMinor,
          allocation: z.object({ totals }).passthrough(),
        })
        .passthrough()
        .nullable(),
      creditDocumentId: z.uuid().nullable(),
    }),
  ),
  pendingCases: z.array(
    z.object({ id: z.uuid(), kind: z.string(), status: z.string() }),
  ),
});
export type ReconciliationSource = z.infer<typeof reconciliationSourceSchema>;
export type ReconciliationPeriod = z.infer<typeof reconciliationPeriodSchema>;

const label = z.string().trim().min(1).max(200);
const note = z.string().trim().min(1).max(2000);
export const reconciliationEvidenceSchema = z.strictObject({
  requestKey: z.uuid(),
  source: z.enum([
    "provider_statement",
    "bank_statement",
    "conversion_confirmation",
  ]),
  reference: label,
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/),
  contentType: z.enum(["text/plain", "application/pdf", "text/csv"]),
  contentBase64: z
    .string()
    .min(4)
    .max(350000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  note,
});
export const reconciliationConversionSchema = z.strictObject({
  numerator: reconciliationMinor.refine((v) => BigInt(v) > 0n),
  denominator: reconciliationMinor.refine((v) => BigInt(v) > 0n),
  units: z.literal("target_minor_per_source_minor"),
  effectiveAt: z.iso.datetime(),
  rounding: z.enum(["half_up", "floor"]),
  evidenceId: z.uuid(),
  reference: label,
});
export const reconciliationLineSchema = z.strictObject({
  kind: z.enum(["capture", "refund", "dispute", "unclassified"]),
  sourceId: z.uuid().nullable(),
  businessId: z.uuid().nullable(),
  paymentId: label.nullable(),
  nativeId: label,
  nativeInvoiceId: label.nullable(),
  orderId: label.nullable(),
  original: reconciliationMoney.nullable(),
  convertedMinor: reconciliationMinor.nullable(),
  conversion: reconciliationConversionSchema.nullable(),
  creditMinor: reconciliationMinor,
  debitMinor: reconciliationMinor,
  feeMinor: reconciliationMinor.nullable(),
  feeTaxMinor: reconciliationMinor.nullable(),
  feePresentation: z.enum(["inclusive", "exclusive", "unavailable"]),
});
const commonEntry = {
  requestKey: z.uuid(),
  supersedes: z.uuid().nullable(),
  supersedesAlso: z
    .array(z.uuid())
    .max(20)
    .refine((v) => new Set(v).size === v.length)
    .default([]),
  evidenceId: z.uuid(),
  provider: z.literal("razorpay"),
  account: label,
  mode: z.enum(["fixture", "test", "live"]),
  observedAt: z.iso.datetime(),
  reference: label,
  note,
  settlementId: label,
  bankAccountRef: label,
  transferReference: label.nullable(),
  money: reconciliationMoney,
};
export const reconciliationEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...commonEntry,
    kind: z.literal("settlement"),
    status: z.enum(["created", "processed", "failed"]),
    transferAt: z.iso.datetime().nullable(),
    period: reconciliationPeriodSchema,
    creditMinor: reconciliationMinor.nullable(),
    debitMinor: reconciliationMinor.nullable(),
    fees: z.strictObject({
      coverage: z.enum(["lines", "aggregate", "unavailable"]),
      amountMinor: reconciliationMinor.nullable(),
      taxMinor: reconciliationMinor.nullable(),
      presentation: z.enum(["inclusive", "exclusive", "unavailable"]),
    }),
    lines: z.array(reconciliationLineSchema).min(1).max(1000),
  }),
  z.strictObject({
    ...commonEntry,
    kind: z.literal("bank_receipt"),
    bankTransactionId: label,
    valueAt: z.union([z.iso.datetime(), z.iso.date()]),
  }),
]);
export type ReconciliationEntry = z.infer<typeof reconciliationEntrySchema>;
export type ReconciliationLine = z.infer<typeof reconciliationLineSchema>;
export type ReconciliationEvidenceInput = z.infer<
  typeof reconciliationEvidenceSchema
>;
export const reconciliationReviewSchema = z.strictObject({
  requestKey: z.uuid(),
  recordId: z.uuid(),
  reportHash: z.string().regex(/^[a-f0-9]{64}$/),
  outcome: z.enum(["acknowledged", "resolved"]),
  note,
  evidenceIds: z.array(z.uuid()).min(1).max(20),
});

export const reconciliationEvidenceViewSchema = z.object({
  id: z.uuid(),
  source: z.enum([
    "provider_statement",
    "bank_statement",
    "conversion_confirmation",
  ]),
  reference: label,
  name: z.string(),
  contentType: z.string(),
  sha256: z.string(),
  bytes: z.number(),
  actorId: z.string(),
  at: z.iso.datetime(),
  storageIdentity: z.string(),
  provenance: z.literal("operator_assertion"),
});
const reportReviewSchema = z.object({
  id: z.uuid(),
  actorId: z.string(),
  at: z.iso.datetime(),
  outcome: z.string(),
  note: z.string(),
  reportHash: z.string(),
  discrepancy: z.record(z.string(), z.unknown()),
});
export const reconciliationWorkspaceSchema = z.object({
  period: reconciliationPeriodSchema,
  sources: z.array(reconciliationSourceSchema),
  linkedSources: z.array(reconciliationSourceSchema),
  expected: z.array(
    z.object({
      currency: z.string(),
      precision: z.number(),
      grossMinor: z.string(),
      salesTaxMinor: z.string(),
      revenueMinor: z.string(),
      refundCashMinor: z.string(),
      disputeDeductionMinor: z.string(),
      creditGrossMinor: z.string(),
      creditTaxMinor: z.string(),
    }),
  ),
  observed: z.array(
    z.object({
      provider: z.string(),
      account: z.string(),
      mode: z.string(),
      currency: z.string(),
      precision: z.number(),
      recordIds: z.array(z.uuid()),
      expectedNetMinor: z.string().nullable(),
      providerNetMinor: z.string().nullable(),
      transferMinor: z.string().nullable(),
      bankMinor: z.string().nullable(),
      providerDifferenceMinor: z.string().nullable(),
      bankDifferenceMinor: z.string().nullable(),
      processingCostMinor: z.string().nullable(),
      feeTaxMinor: z.string().nullable(),
      coverage: z.string(),
    }),
  ),
  settlements: z.array(
    z.object({
      id: z.uuid(),
      actorId: z.string(),
      at: z.iso.datetime(),
      data: reconciliationEntrySchema,
      provenance: z.literal("operator_assertion"),
      expectedNetMinor: z.string().nullable(),
      observedNetMinor: z.string().nullable(),
      providerDifferenceMinor: z.string().nullable(),
      transferDifferenceMinor: z.string().nullable(),
      processingCostMinor: z.string().nullable(),
      feeTaxMinor: z.string().nullable(),
      bankObservedMinor: z.string().nullable(),
      bankDifferenceMinor: z.string().nullable(),
      receipts: z.array(
        z.object({
          id: z.uuid(),
          actorId: z.string(),
          at: z.iso.datetime(),
          data: reconciliationEntrySchema,
          valueTimePrecision: z.enum(["date_only", "instant"]),
          valueTimeZone: z.literal("UTC").nullable(),
          matchingBasis: z.enum([
            "calendar_date_compatibility_only",
            "utc_instant_compatibility",
          ]),
          matched: z.boolean(),
        }),
      ),
      reasons: z.array(z.string()),
      status: z.string(),
      reportHash: z.string(),
      reviews: z.array(reportReviewSchema),
    }),
  ),
  evidence: z.array(reconciliationEvidenceViewSchema),
  reviews: z.array(reportReviewSchema.extend({ recordId: z.uuid() })),
  unresolved: z.array(z.object({ sourceId: z.string(), reason: z.string() })),
  history: z.array(
    z.object({
      id: z.uuid(),
      actorId: z.string(),
      at: z.iso.datetime(),
      supersedes: z.uuid().nullable(),
      data: reconciliationEntrySchema,
    }),
  ),
  unlinkedReceipts: z.array(
    z.object({ id: z.uuid(), data: reconciliationEntrySchema }),
  ),
});
export type ReconciliationWorkspace = z.infer<
  typeof reconciliationWorkspaceSchema
>;
