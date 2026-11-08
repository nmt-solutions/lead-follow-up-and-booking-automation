import { z } from "zod";

/** Operator-owned deployment configuration. No commercial or legal policy is seeded. */
export const lifecyclePolicySchema = z.strictObject({
  id: z.string().min(1).max(100),
  version: z.number().int().positive(),
  mode: z.enum(["fixture", "test", "live"]),
  reviewedBy: z.string().min(1).max(200),
  checkedAt: z.iso.datetime(),
  effectiveFrom: z.iso.datetime(),
  effectiveUntil: z.iso.datetime(),
  evidence: z.array(z.string().min(1).max(500)).min(1).max(20),
  graceSeconds: z
    .number()
    .int()
    .nonnegative()
    .max(366 * 86400),
  graceAccess: z.enum(["none", "remaining_allowance"]),
  cancellationTiming: z.enum(["immediate", "cycle_end"]),
  cancellationAccess: z.enum(["paid_through", "provider_end"]),
  preserveRecords: z.literal(true),
});
export type LifecyclePolicy = z.infer<typeof lifecyclePolicySchema>;
export function effectiveLifecyclePolicy(
  policy: LifecyclePolicy | undefined,
  mode: string,
  at: Date,
) {
  return policy &&
    policy.mode === mode &&
    new Date(policy.checkedAt) <= at &&
    new Date(policy.effectiveFrom) <= at &&
    new Date(policy.effectiveUntil) > at
    ? policy
    : null;
}
export const lifecycleObservationSchema = z.strictObject({
  provider: z.string().min(1).max(200),
  account: z.string().min(1).max(200),
  operationKey: z.uuid(),
  subscriptionId: z.string().min(1).max(200),
  status: z.enum([
    "created",
    "authenticated",
    "active",
    "pending",
    "halted",
    "cancelled",
    "completed",
    "expired",
    "paused",
  ]),
  currentEnd: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  observedAt: z.iso.datetime(),
  unpaidPeriodStart: z.iso.datetime().nullable().optional(),
});
export type LifecycleObservation = z.infer<typeof lifecycleObservationSchema>;
export const lifecycleSchema = z.object({
  state: z.enum(["pending", "active", "past_due", "cancelled"]),
  accessState: z.enum(["paid", "grace", "blocked"]),
  paidThrough: z.iso.datetime().nullable(),
  graceEnd: z.iso.datetime().nullable(),
  failedThrough: z.iso.datetime().nullable(),
  policy: lifecyclePolicySchema.nullable(),
  provider: lifecycleObservationSchema.nullable(),
  reason: z.string().nullable(),
  evaluatedAt: z.iso.datetime(),
  cancellation: z
    .object({
      requestKey: z.uuid(),
      requestedAt: z.iso.datetime(),
      actorId: z.string(),
      timing: z.enum(["immediate", "cycle_end"]),
      access: z.enum(["paid_through", "provider_end"]),
      paidThroughAtRequest: z.iso.datetime().nullable(),
      status: z.enum(["requested", "confirmed"]),
      confirmedAt: z.iso.datetime().nullable(),
      effectiveEnd: z.iso.datetime().nullable(),
    })
    .nullable(),
});
export type SubscriptionLifecycle = z.infer<typeof lifecycleSchema>;
export const lifecycleEventSchema = z.object({
  id: z.uuid(),
  actionId: z.uuid(),
  businessId: z.uuid(),
  key: z.string(),
  kind: z.string(),
  actorId: z.string().nullable(),
  at: z.iso.datetime(),
  lifecycle: lifecycleSchema,
  notice: z
    .object({
      kind: z.enum([
        "payment_pending",
        "payment_active",
        "payment_failed",
        "access_ended",
        "payment_recovered",
        "cancellation_requested",
        "cancellation_confirmed",
        "payment_method_ready",
      ]),
      channel: z.literal("in_app"),
      status: z.literal("available"),
    })
    .nullable(),
});
export type LifecycleEvent = z.infer<typeof lifecycleEventSchema>;
export const lifecycleCommandSchema = z.strictObject({
  actionId: z.uuid(),
  requestKey: z.uuid(),
});
export const recoveryCheckoutSchema = z.strictObject({
  script: z.literal("https://checkout.razorpay.com/v1/checkout.js"),
  key: z.string().regex(/^rzp_(test|live)_[A-Za-z0-9]+$/),
  subscription_id: z.string().regex(/^sub_[A-Za-z0-9]+$/),
  subscription_card_change: z.literal(true),
});
