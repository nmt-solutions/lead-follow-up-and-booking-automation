import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { subscriptionQuoteSchema } from "./subscription-quotes";
import { taxCalculationSchema } from "./tax";

const ref = z.string().min(1).max(200);
export const preparePaymentSchema = z.strictObject({
  quoteId: z.uuid(),
  requestKey: z.uuid(),
});
export const paymentCommandSchema = z.strictObject({ actionId: z.uuid() });
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
export function periodEnd(start: string, term: PaymentTerm) {
  return Temporal.Instant.from(start)
    .toZonedDateTimeISO(term.timeZone)
    .add(term.kind === "days" ? { days: term.days } : { months: 1 })
    .toInstant()
    .toString({ smallestUnit: "millisecond" });
}
export const paymentSnapshotSchema = z.object({
  quote: subscriptionQuoteSchema,
  tax: taxCalculationSchema,
  term: paymentTermSchema,
  provider: z.object({
    key: ref,
    account: ref,
    mode: z.enum(["fixture", "live"]),
  }),
});
export type PaymentSnapshot = z.infer<typeof paymentSnapshotSchema>;
export const checkoutReferenceSchema = z.strictObject({
  customerId: ref,
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
  operationKey: z.uuid(),
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
});
export type PaidPeriod = z.infer<typeof paidPeriodSchema>;
export const paidAccessSchema = z.object({
  active: z.boolean(),
  paidThrough: z.iso.datetime().nullable(),
  period: paidPeriodSchema.nullable(),
});
export const paymentWorkspaceSchema = z.object({
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
    mode: z.enum(["fixture", "live", "unconfigured"]),
  }),
});
export type PaymentWorkspace = z.infer<typeof paymentWorkspaceSchema>;

/** Only the external adapter authenticates raw events and retrieves authoritative payment state.
 * Creation must use this exact persisted operation key. A timeout must NEVER be retried as a new charge.
 * #45 implements this contract with native Razorpay, without browser/session authority. */
export type PaymentGateway = {
  key: string;
  account: string;
  mode: "fixture" | "live" | "unconfigured";
  supports(currency: "INR" | "USD"): boolean;
  create(input: {
    operationKey: string;
    actionId: string;
    businessId: string;
    snapshot: PaymentSnapshot;
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
