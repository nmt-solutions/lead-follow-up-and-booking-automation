import { z } from "zod";
import { upiPathSchema } from "./upi-autopay";

const text = z.string().trim().min(1).max(2000);
const evidence = z.array(text).min(1).max(20);
const capability = z.strictObject({
  enabled: z.boolean(),
  currency: z.enum(["INR", "USD"]),
  maxChargeMinor: z.string().regex(/^[1-9]\d{0,14}$/),
  evidence,
});
/** Deployment-operator evidence, never a Business's self-authorizing declaration. No secrets. */
export const razorpayAccountReviewSchema = z.strictObject({
  upiPath: upiPathSchema.optional(),
  id: z.string().min(1).max(100),
  version: z.number().int().positive(),
  account: z.string().regex(/^acc_[A-Za-z0-9]+$/),
  mode: z.enum(["test", "live"]),
  reviewedBy: text,
  checkedAt: z.iso.datetime(),
  effectiveFrom: z.iso.datetime(),
  effectiveUntil: z.iso.datetime(),
  evidence,
  subscriptions: z.boolean(),
  methods: z.strictObject({
    card: z.boolean(),
    upi: z.boolean(),
    emandate: z.boolean(),
  }),
  settlement: z.enum(["INR", "unknown"]),
  domestic: capability.extend({ currency: z.literal("INR") }),
  international: capability.extend({ currency: z.literal("USD") }),
  terms: z.strictObject({
    activation: text,
    fees: text,
    recurringSurcharge: text,
    feeTaxes: text,
    fx: text,
  }),
  calendar: z.strictObject({ utcCalendarMonth: z.boolean(), evidence }),
  internationalUpdates: z.enum([
    "unknown",
    "new_mandate",
    "native_proration_reviewed",
  ]),
  plans: z
    .array(
      z.strictObject({
        offerId: z.string().min(1).max(80),
        reservedCapacityId: z.string().nullable(),
        currency: z.enum(["INR", "USD"]),
        planId: z.string().regex(/^plan_[A-Za-z0-9]+$/),
        totalCount: z.number().int().positive().max(1000),
      }),
    )
    .max(100),
});
export type RazorpayAccountReview = z.infer<typeof razorpayAccountReviewSchema>;
