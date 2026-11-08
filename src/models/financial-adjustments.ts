import { z } from "zod";
import { adjustDocumentSchema, sellerDocumentSchema } from "./seller-documents";
import { paidPeriodSchema } from "./subscription-payments";
import { ApplicationError } from "./application-error";

const text = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine((v) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v));
const access = z.enum(["preserve", "block_period"]);
export const adjustmentPolicySchema = z
  .strictObject({
    id: text,
    version: z.number().int().positive(),
    mode: z.enum(["test", "live"]),
    account: text,
    reviewedBy: text,
    checkedAt: z.iso.datetime(),
    effectiveFrom: z.iso.datetime(),
    effectiveUntil: z.iso.datetime(),
    evidence: z.array(text).min(1).max(20),
    normalRefunds: z.boolean(),
    acceptDisputes: z.boolean(),
    contestDisputes: z.boolean(),
    partialRefundAccess: access,
    fullRefundAccess: access,
    disputeOpenAccess: access,
    disputeLostAccess: access,
    disputeWonAccess: access,
    disputeClosedAccess: access,
    disputeLostCredit: z.boolean(),
    preserveRecords: z.literal(true),
  })
  .refine((v) => new Date(v.effectiveUntil) > new Date(v.effectiveFrom));
export type AdjustmentPolicy = z.infer<typeof adjustmentPolicySchema>;
export function currentAdjustmentPolicy(
  policy: AdjustmentPolicy | null,
  at: Date,
  account: string,
  mode: string,
) {
  if (
    !policy ||
    policy.account !== account ||
    policy.mode !== mode ||
    new Date(policy.checkedAt) > at ||
    new Date(policy.effectiveFrom) > at ||
    new Date(policy.effectiveUntil) <= at
  )
    throw new ApplicationError("SETUP_REQUIRED");
  return policy;
}
export const reviewAdjustmentSchema = z
  .strictObject({
    kind: z.enum(["refund", "dispute"]),
    invoiceId: z.uuid(),
    requestKey: z.uuid(),
    disputeId: z
      .string()
      .regex(/^disp_[A-Za-z0-9]+$/)
      .optional(),
    disputeAmountMinor: z
      .string()
      .regex(/^[1-9]\d{0,14}$/)
      .optional(),
    lines: adjustDocumentSchema.shape.lines,
    reason: text,
    evidence: z.array(text).min(1).max(20),
  })
  .refine(
    (v) =>
      (v.kind === "dispute"
        ? !!v.disputeId
        : !v.disputeId && v.disputeAmountMinor === undefined) &&
      new Set(v.lines.map((l) => l.lineId)).size === v.lines.length,
  );
export type ReviewAdjustment = z.infer<typeof reviewAdjustmentSchema>;
export const adjustmentCommandSchema = z.strictObject({ caseId: z.uuid() });
export const reviewCreditSchema = z
  .strictObject({
    caseId: z.uuid(),
    requestKey: z.uuid(),
    lines: adjustDocumentSchema.shape.lines,
    reason: text,
    evidence: z.array(text).min(1).max(20),
  })
  .refine((v) => new Set(v.lines.map((l) => l.lineId)).size === v.lines.length);
export type ReviewCredit = z.infer<typeof reviewCreditSchema>;
export const disputeActionSchema = z
  .strictObject({
    caseId: z.uuid(),
    requestKey: z.uuid(),
    action: z.enum(["accept", "draft", "submit"]),
    summary: z.string().trim().max(1000).default(""),
    documents: z
      .array(
        z.strictObject({
          category: z.enum([
            "shipping_proof",
            "billing_proof",
            "cancellation_proof",
            "customer_communication",
            "proof_of_service",
            "explanation_letter",
            "refund_confirmation",
            "access_activity_log",
            "refund_cancellation_policy",
            "term_and_conditions",
          ]),
          documentId: z.string().regex(/^doc_[A-Za-z0-9]+$/),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      )
      .max(5)
      .default([]),
  })
  .refine((v) =>
    v.action === "accept"
      ? v.documents.length === 0 && v.summary === ""
      : v.summary.length > 0 &&
        (v.action !== "submit" || v.documents.length > 0),
  );
export type DisputeAction = z.infer<typeof disputeActionSchema>;
export const disputeIntentSchema = z.object({
  input: disputeActionSchema,
  body: z.string(),
  documents: z.array(
    z.object({
      documentId: z.string(),
      sha256: z.string(),
      contentType: z.string(),
      base64: z.string(),
    }),
  ),
});
export type DisputeIntent = z.infer<typeof disputeIntentSchema>;
/** The adapter may emit this ONLY before invoking the external mutation endpoint. */
export class FinancialWriteNotAttempted extends Error {
  constructor(options?: ErrorOptions) {
    super("Financial mutation was not attempted", options);
  }
}
export const nativeRefundSchema = z.object({
  id: z.string().regex(/^rfnd_[A-Za-z0-9]+$/),
  entity: z.literal("refund"),
  payment_id: z.string(),
  amount: z.number().int().positive().safe(),
  currency: z.enum(["INR", "USD"]),
  status: z.enum(["pending", "processed", "failed"]),
  receipt: z.string().nullable(),
  notes: z.record(z.string(), z.unknown()),
  created_at: z.number().int().nonnegative(),
  acquirer_data: z
    .object({ arn: z.string().nullable().optional() })
    .passthrough()
    .optional(),
});
export const nativeDisputeSchema = z.object({
  id: z.string().regex(/^disp_[A-Za-z0-9]+$/),
  entity: z.literal("dispute"),
  payment_id: z.string(),
  amount: z.number().int().positive().safe(),
  currency: z.enum(["INR", "USD"]),
  amount_deducted: z.number().int().nonnegative().safe(),
  status: z.enum(["open", "under_review", "won", "lost", "closed"]),
  phase: text,
  reason_code: text,
  respond_by: z.number().int().nonnegative(),
  created_at: z.number().int().nonnegative(),
  evidence: z.record(z.string(), z.unknown()),
});
export const adjustmentObservationSchema = z.strictObject({
  nativeId: z.string(),
  paymentId: z.string(),
  currency: z.enum(["INR", "USD"]),
  amountMinor: z.string().regex(/^\d+$/),
  status: z.enum([
    "pending",
    "processed",
    "failed",
    "open",
    "under_review",
    "won",
    "lost",
    "closed",
  ]),
  deductedMinor: z.string().regex(/^\d+$/),
  createdAt: z.iso.datetime(),
  observedAt: z.iso.datetime(),
  phase: z.string().nullable(),
  respondBy: z.iso.datetime().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  acquirerReference: z.string().nullable(),
});
export type AdjustmentObservation = z.infer<typeof adjustmentObservationSchema>;
export const adjustmentIntentSchema = z.object({
  input: reviewAdjustmentSchema,
  invoice: sellerDocumentSchema,
  period: paidPeriodSchema,
  policy: adjustmentPolicySchema,
  key: z.uuid(),
  body: z.string(),
  allocation: z.object({
    lines: sellerDocumentSchema.shape.snapshot.shape.lines,
    totals: sellerDocumentSchema.shape.snapshot.shape.totals,
    cumulative: z.array(z.unknown()),
  }),
});
export type AdjustmentIntent = z.infer<typeof adjustmentIntentSchema>;
export function reviewedNativeAmount(intent: AdjustmentIntent) {
  return intent.input.kind === "dispute"
    ? (intent.input.disputeAmountMinor ?? intent.allocation.totals.totalMinor)
    : intent.allocation.totals.totalMinor;
}
export const creditBasisSchema = z.object({
  input: reviewCreditSchema,
  allocation: adjustmentIntentSchema.shape.allocation,
  actualMinor: z.string(),
  uncreditedDifferenceMinor: z.string(),
  actorId: z.string(),
  at: z.iso.datetime(),
});
export type CreditBasis = z.infer<typeof creditBasisSchema>;
export const adjustmentDetailsSchema = adjustmentIntentSchema.extend({
  creditReviews: z.array(creditBasisSchema),
  commands: z.array(
    disputeIntentSchema.omit({ documents: true }).extend({
      documents: z.array(
        disputeIntentSchema.shape.documents.element.omit({ base64: true }),
      ),
    }),
  ),
});
export const adjustmentViewSchema = z.object({
  id: z.uuid(),
  businessId: z.uuid(),
  periodId: z.uuid(),
  invoiceId: z.uuid(),
  invoiceNumber: z.string(),
  paymentId: z.string(),
  kind: z.enum(["refund", "dispute"]),
  currency: z.enum(["INR", "USD"]),
  amountMinor: z.string(),
  state: z.string(),
  creditDocumentId: z.uuid().nullable(),
  creditAmountMinor: z.string(),
  creditState: z.enum([
    "not_applicable",
    "pending",
    "review_required",
    "not_required",
    "issued",
  ]),
  reviewRequired: z.boolean(),
  access,
  started: z.boolean(),
  observation: adjustmentObservationSchema.nullable(),
  at: z.iso.datetime(),
  actions: z
    .array(
      z.object({
        requestKey: z.uuid(),
        action: z.enum(["accept", "draft", "submit"]),
        state: z.enum(["unknown", "confirmed", "not_attempted"]),
      }),
    )
    .default([]),
  notices: z.array(
    z.object({
      id: z.uuid(),
      channel: z.literal("in_app"),
      status: z.literal("available"),
      message: z.string(),
      at: z.iso.datetime(),
    }),
  ),
});
export type AdjustmentView = z.infer<typeof adjustmentViewSchema>;
export const adjustmentWorkspaceSchema = z.object({
  cases: z.array(adjustmentViewSchema),
  invoices: z.array(sellerDocumentSchema).default([]),
  policy: adjustmentPolicySchema.nullable(),
  ready: z.boolean(),
});
export type FinancialWork = {
  id: string;
  business_id: string;
  recovery_key: string;
};
export const financialReceiptSchema = z.strictObject({
  eventId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  account: z.string(),
  mode: z.enum(["test", "live"]),
  kind: z.enum(["refund", "dispute"]),
  eventName: z.string(),
  nativeId: z.string(),
  paymentId: z.string(),
  caseRef: z.uuid().nullable(),
});
export type FinancialReceipt = z.infer<typeof financialReceiptSchema>;
export type FinancialGateway = {
  accounts?: FinancialGateway[];
  account: string;
  mode: "test" | "live" | "unconfigured";
  policy: AdjustmentPolicy | null;
  validate(intent: AdjustmentIntent): Promise<{ refundedMinor: string }>;
  refund(
    intent: AdjustmentIntent,
    authorize: () => Promise<void>,
  ): Promise<AdjustmentObservation>;
  poll(
    intent: AdjustmentIntent,
    previous: AdjustmentObservation | null,
    skip: number,
  ): Promise<{ observation: AdjustmentObservation | null; skip: number }>;
  prepareDispute(
    intent: AdjustmentIntent,
    input: DisputeAction,
  ): Promise<DisputeIntent>;
  dispute(
    intent: AdjustmentIntent,
    command: DisputeIntent,
    authorize: () => Promise<void>,
  ): Promise<{ observation: AdjustmentObservation; confirmed: boolean }>;
  confirmDispute(
    intent: AdjustmentIntent,
    command: DisputeIntent,
  ): Promise<{ observation: AdjustmentObservation; confirmed: boolean }>;
  authenticateEvent(input: {
    body: Uint8Array;
    headers: Headers;
  }): Promise<FinancialReceipt>;
};
