import { z } from "zod";
import { upiAgreementSchema } from "./upi-autopay";
import type { ReachGateway } from "./reach-changes";
import {
  lifecycleSchema,
  lifecycleEventSchema,
  type LifecyclePolicy,
  type LifecycleObservation,
  type recoveryCheckoutSchema,
} from "./subscription-lifecycle";
import { Temporal } from "@js-temporal/polyfill";
import {
  subscriptionQuoteSchema,
  allowanceSchema,
  reservedCapacitySchema,
} from "./subscription-quotes";
import { taxCalculationSchema } from "./tax";
import {
  razorpayAccountReviewSchema,
  type RazorpayAccountReview,
} from "./razorpay-account";

const ref = z.string().min(1).max(200);
export const preparePaymentSchema = z.strictObject({
  quoteId: z.uuid(),
  requestKey: z.uuid(),
});
export const paymentCommandSchema = z.strictObject({ actionId: z.uuid() });
export const pilotRenewalSchema = z.strictObject({
  originalActionId: z.uuid(),
  originalPeriodId: z.uuid(),
  requestKey: z.uuid(),
  startAt: z.iso
    .datetime()
    .refine(
      (v) => Date.parse(v) % 1000 === 0,
      "Native schedules require whole seconds.",
    ),
  approvalExpiresAt: z.iso
    .datetime()
    .refine(
      (v) => Date.parse(v) % 1000 === 0,
      "Native schedules require whole seconds.",
    ),
  agreeSeparateMandate: z.literal(true),
});
export const mandateProofSchema = z.strictObject({
  actionId: z.uuid(),
  requestKey: z.uuid(),
  paymentId: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  subscriptionId: z.string().regex(/^sub_[A-Za-z0-9]+$/),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});
export type MandateProof = z.infer<typeof mandateProofSchema>;
export const pilotCheckoutProofSchema = z.strictObject({
  actionId: z.uuid(),
  orderId: z.string().regex(/^order_[A-Za-z0-9]+$/),
  paymentId: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  signature: z.string().regex(/^[a-fA-F0-9]{64}$/),
});
export type PilotCheckoutProof = z.infer<typeof pilotCheckoutProofSchema>;
export const paymentTermSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("calendar_month"),
    timeZone: z.literal("UTC"),
  }),
  z.strictObject({
    kind: z.literal("days"),
    days: z.number().int().positive().max(366),
    timeZone: z.literal("UTC"),
  }),
]);
export type PaymentTerm = z.infer<typeof paymentTermSchema>;
export const chargeTaxSchema = taxCalculationSchema
  .omit({
    version: true,
    requestKey: true,
    resolvesId: true,
    purpose: true,
    actorId: true,
    actorName: true,
    note: true,
  })
  .extend({ purpose: z.literal("subscription_charge"), actionId: z.uuid() });
export function periodEnd(start: string, term: PaymentTerm) {
  return Temporal.Instant.from(start)
    .toZonedDateTimeISO(term.timeZone)
    .add(term.kind === "days" ? { days: term.days } : { months: 1 })
    .toInstant()
    .toString({ smallestUnit: "millisecond" });
}
/** Clamp each boundary from the original monthly anchor, retaining January 31 after February. */
export function monthlyPeriodBoundary(anchor: string, months: number) {
  return Temporal.Instant.from(anchor)
    .toZonedDateTimeISO("UTC")
    .add({ months })
    .toInstant()
    .toString({ smallestUnit: "millisecond" });
}
export function monthlyPeriodMatches(
  anchor: string,
  start: string,
  end: string,
  maximumCycles?: number,
) {
  const a = new Date(anchor),
    s = new Date(start);
  const cycle =
    (s.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    s.getUTCMonth() -
    a.getUTCMonth();
  return (
    cycle >= 0 &&
    (maximumCycles === undefined || cycle < maximumCycles) &&
    monthlyPeriodBoundary(anchor, cycle) === start &&
    monthlyPeriodBoundary(anchor, cycle + 1) === end
  );
}
export const paymentSnapshotSchema = z.object({
  pilotContinuation: z
    .object({
      originalActionId: z.uuid(),
      originalPeriodId: z.uuid(),
      customerId: ref,
      originalEnd: z.iso.datetime(),
      startAt: z.iso.datetime(),
      approvalExpiresAt: z.iso.datetime(),
      disclosure: z.string(),
    })
    .optional(),
  collection: z
    .object({
      method: z.enum(["card", "upi"]),
      planId: z.string(),
      totalCount: z.number().int().positive(),
    })
    .optional(),
  upi: upiAgreementSchema.optional(),
  /** A separate immutable captured adjustment; never an ordinary renewable paid term. */
  adjustment: z
    .object({
      kind: z.literal("reach_delta"),
      version: z.literal(1),
      changeId: z.uuid(),
      originalPeriodId: z.uuid(),
      start: z.iso.datetime(),
      end: z.iso.datetime(),
      pricing: z.object({
        sourceQuoteId: z.uuid(),
        targetQuoteId: z.uuid(),
        fromMonthlyNetMinor: z.string(),
        toMonthlyNetMinor: z.string(),
      }),
      proration: z.object({
        numerator: z.string(),
        denominator: z.string(),
        basis: z.enum(["remaining_calendar_seconds", "remaining_utc_days"]),
        rounding: z.literal("half_up"),
        timeZone: z.literal("UTC"),
      }),
      policy: z.object({
        id: z.string(),
        version: z.number().int().positive(),
        reviewedBy: z.string(),
        evidence: z.array(z.string()),
      }),
      scope: z.object({
        markets: z.array(z.string()),
        discovery: allowanceSchema,
        automation: allowanceSchema,
      }),
      consumed: z.object({
        discovery: z.number().int().nonnegative(),
        automation: z.number().int().nonnegative(),
      }),
    })
    .optional(),
  replacement: z
    .object({
      changeId: z.uuid(),
      originalActionId: z.uuid(),
      start: z.iso.datetime(),
      customerId: z.string(),
    })
    .optional(),
  reachRenewal: z.object({ changeId: z.uuid() }).optional(),
  quote: subscriptionQuoteSchema,
  tax: z.union([taxCalculationSchema, chargeTaxSchema]),
  basis: z
    .object({
      kind: z.enum(["initial", "renewal"]),
      discovery: allowanceSchema,
      automation: allowanceSchema,
    })
    .optional(),
  term: paymentTermSchema,
  provider: z.object({
    key: ref,
    account: ref,
    mode: z.enum(["fixture", "test", "live"]),
    review: razorpayAccountReviewSchema.optional(),
  }),
});
export type PaymentSnapshot = z.infer<typeof paymentSnapshotSchema>;
export const checkoutReferenceSchema = z.strictObject({
  mandate: z
    .strictObject({
      script: z.literal("https://checkout.razorpay.com/v1/checkout.js"),
      key: ref,
      customer_id: ref,
      subscription_id: ref,
    })
    .optional(),
  standard: z
    .strictObject({
      script: z.literal("https://checkout.razorpay.com/v1/checkout.js"),
      key: ref,
      order_id: ref,
      customer_id: ref,
      amount: z.number().int().positive().safe(),
      currency: z.enum(["INR", "USD"]),
    })
    .optional(),
  customerId: ref.nullable(),
  planId: ref.optional(),
  checkoutId: ref,
  subscriptionId: ref.nullable(),
  url: z
    .url()
    .max(2048)
    .refine((value) => {
      const u = new URL(value);
      return u.protocol === "https:" && !u.username && !u.password;
    }),
});
export type CheckoutReference = z.infer<typeof checkoutReferenceSchema>;
export const paymentObservationSchema = z.strictObject({
  provider: ref,
  account: ref,
  operationKey: z.uuid().nullable(),
  status: z.enum(["pending", "failed", "confirmed", "unknown"]),
  customerId: ref.nullable(),
  checkoutId: ref.nullable(),
  subscriptionId: ref.nullable(),
  paymentId: ref.nullable(),
  currency: z.enum(["INR", "USD"]).nullable(),
  amountMinor: z
    .string()
    .regex(/^\d{1,20}$/)
    .nullable(),
  paidAt: z.iso.datetime().nullable(),
  periodStart: z.iso.datetime().nullable(),
  periodEnd: z.iso.datetime().nullable(),
  checkout: checkoutReferenceSchema.nullable().default(null),
  native: z
    .strictObject({
      event: z.string().min(1).max(100),
      status: z.string().max(50).nullable(),
      occurredAt: z.iso.datetime().nullable(),
    })
    .optional(),
  review: z
    .strictObject({
      invoiceId: ref,
      reason: z.literal("paid_invoice_binding_mismatch"),
    })
    .optional(),
  charge: z
    .strictObject({
      kind: z.enum(["initial", "renewal", "reach_delta"]).optional(),
      invoiceId: ref.nullable(),
      refundedMinor: z.string().regex(/^\d+$/).optional(),
      orderId: ref,
      planId: ref,
      method: z.enum(["card", "upi"]),
      international: z.boolean(),
      subscriptionStart: z.iso.datetime(),
      feeMinor: z.string().regex(/^\d+$/).nullable(),
      feeTaxMinor: z.string().regex(/^\d+$/).nullable(),
      baseAmountMinor: z.string().regex(/^\d+$/).nullable(),
      baseCurrency: z.literal("INR").nullable(),
    })
    .optional(),
});
export type PaymentObservation = z.infer<typeof paymentObservationSchema>;
export const authenticatedPaymentEventSchema = z.strictObject({
  eventId: ref,
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  observation: paymentObservationSchema,
});
export type AuthenticatedPaymentEvent = z.infer<
  typeof authenticatedPaymentEventSchema
>;
export const paymentActionSchema = z.object({
  nativeTerms: z
    .object({ planId: ref, totalCount: z.number().int().positive() })
    .optional(),
  reachRenewals: z
    .array(
      z.object({
        changeId: z.uuid(),
        effectiveAt: z.iso.datetime(),
        renewalAt: z.iso.datetime(),
        target: paymentSnapshotSchema,
        native: z.object({
          planId: z.string(),
          totalCount: z.number().int(),
          updated: z.boolean(),
        }),
        deltaPaymentId: z.string().nullable(),
      }),
    )
    .optional(),
  settledPaymentIds: z.array(z.string()).optional(),
  settledCaptures: z.array(paymentObservationSchema).optional(),
  id: z.uuid(),
  businessId: z.uuid(),
  requestKey: z.uuid(),
  operationKey: z.uuid(),
  snapshot: paymentSnapshotSchema,
  state: z.enum([
    "reviewed",
    "checkout",
    "pending",
    "review_required",
    "confirmed",
    "failed",
  ]),
  reason: z.string().nullable(),
  checkout: checkoutReferenceSchema.nullable(),
  started: z.boolean(),
  reconciliationPending: z.boolean(),
  observation: paymentObservationSchema.nullable(),
  recovery: z
    .object({
      subscriptionSkip: z.number().int().nonnegative(),
      creationAt: z.iso.datetime().optional(),
      creationLeaseUntil: z.iso.datetime().optional(),
      candidateId: ref.nullable(),
      ambiguous: z.boolean(),
      invoiceSkip: z.number().int().nonnegative(),
    })
    .nullable()
    .optional(),
  lifecycle: lifecycleSchema.nullable().optional(),
  lifecycleEvents: z.array(lifecycleEventSchema).default([]),
  actorId: z.string(),
  at: z.iso.datetime(),
  history: z
    .array(
      z.object({
        id: z.uuid(),
        kind: z.string(),
        actorId: z.string().nullable(),
        detail: z.object({
          state: z.string(),
          reason: z.string().nullable(),
          observation: paymentObservationSchema.nullable(),
        }),
        at: z.iso.datetime(),
      }),
    )
    .default([]),
  events: z
    .array(
      z.object({
        id: z.uuid(),
        eventId: z.string(),
        payloadHash: z.string(),
        observation: paymentObservationSchema,
        at: z.iso.datetime(),
      }),
    )
    .default([]),
});
export type PaymentAction = z.infer<typeof paymentActionSchema>;
export const paidPeriodSchema = z.object({
  id: z.uuid(),
  actionId: z.uuid(),
  businessId: z.uuid(),
  paymentId: ref,
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  snapshot: paymentSnapshotSchema,
  charge: paymentObservationSchema.nullable().optional(),
});
export type PaidPeriod = z.infer<typeof paidPeriodSchema>;
export const paidAccessSchema = z.object({
  active: z.boolean(),
  paidThrough: z.iso.datetime().nullable(),
  period: paidPeriodSchema.nullable(),
});
/** Current acquisition/capacity contract. It carries no billing evidence or sending authority. */
export const paidContractSchema = z.object({
  periodId: z.uuid(),
  actionId: z.uuid(),
  changeId: z.uuid().nullable(),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  markets: z.array(z.string()),
  discovery: allowanceSchema,
  automation: allowanceSchema,
  offerId: z.string(),
  reservedCapacityId: z.string().nullable(),
  reservedCapacity: reservedCapacitySchema.omit({ prices: true }).nullable(),
});
export type PaidContract = z.infer<typeof paidContractSchema>;
export const paymentWorkspaceSchema = z.object({
  effectiveContract: paidContractSchema.nullable().optional(),
  effectiveScope: z
    .object({
      periodId: z.uuid(),
      markets: z.array(z.string()),
      discovery: allowanceSchema,
      automation: allowanceSchema,
    })
    .nullable()
    .optional(),
  actions: z.array(paymentActionSchema),
  periods: z.array(paidPeriodSchema),
  access: paidAccessSchema,
  allowances: z
    .object({
      discovery: z.object({
        unit: z.string(),
        included: z.number(),
        reserved: z.number(),
        remaining: z.number(),
      }),
      automation: z.object({
        unit: z.string(),
        included: z.number(),
        reserved: z.number(),
        remaining: z.number(),
      }),
    })
    .nullable(),
  gateway: z.object({
    ready: z.boolean(),
    key: ref,
    mode: z.enum(["fixture", "test", "live", "unconfigured"]),
    reasons: z.array(z.string()).optional(),
    review: razorpayAccountReviewSchema.optional(),
  }),
});
export type PaymentWorkspace = z.infer<typeof paymentWorkspaceSchema>;
/** An adapter may use this only before any resource-creation request has been sent. */
export class PaymentCreationNotAttempted extends Error {
  constructor() {
    super("Payment creation was not attempted");
  }
}

/** Only the external adapter authenticates raw events and retrieves authoritative payment state.
 * Creation must use this exact persisted operation key. A timeout must NEVER be retried as a new charge.
 * #45 implements this contract with native Razorpay, without browser/session authority. */
export type PaymentGateway = {
  verifyPilotSignature?(
    action: PaymentAction,
    input: { orderId: string; paymentId: string; signature: string },
  ): boolean;
  authenticateCheckout?(input: {
    action: PaymentAction;
    paymentId: string;
    subscriptionId: string;
    signature: string;
  }): Promise<AuthenticatedPaymentEvent>;
  method?: "card" | "upi";
  accounts?: PaymentGateway[];
  nativeRequest?(
    path: string,
    body?: unknown,
    method?: "POST" | "PATCH",
  ): Promise<unknown>;
  reach?: ReachGateway;
  lifecyclePolicy?: LifecyclePolicy;
  updatePayment?(
    action: PaymentAction,
  ): Promise<z.infer<typeof recoveryCheckoutSchema>>;
  cancel?(
    action: PaymentAction,
    timing: "immediate" | "cycle_end",
    authorize: () => Promise<void>,
  ): Promise<LifecycleObservation>;
  key: string;
  account: string;
  mode: "fixture" | "test" | "live" | "unconfigured";
  review?: RazorpayAccountReview;
  readiness?(): string[];
  reviewSnapshot?(snapshot: PaymentSnapshot): string[];
  deferEvents?: boolean;
  poll?(input: { action: PaymentAction }): Promise<{
    checkout: CheckoutReference | null;
    observations: PaymentObservation[];
    recovery: PaymentAction["recovery"];
    lifecycle?: LifecycleObservation;
  }>;
  supports(currency: "INR" | "USD"): boolean;
  create(input: {
    operationKey: string;
    actionId: string;
    businessId: string;
    snapshot: PaymentSnapshot;
    authorize?: () => Promise<void>;
  }): Promise<CheckoutReference>;
  authenticateEvent(input: {
    body: Uint8Array;
    headers: Headers;
  }): Promise<AuthenticatedPaymentEvent>;
  reconcile(input: {
    operationKey: string;
    checkout: CheckoutReference | null;
  }): Promise<PaymentObservation>;
};
