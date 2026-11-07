import { z } from "zod";
import {
  paymentSnapshotSchema,
  paidPeriodSchema,
  paymentActionSchema,
  paymentObservationSchema,
} from "./subscription-payments";
import { allowanceSchema } from "./subscription-quotes";

const evidence = z.array(z.string().min(1).max(2000)).min(1).max(20);
export const reachPolicySchema = z.strictObject({
  id: z.string().min(1).max(100),
  version: z.number().int().positive(),
  mode: z.enum(["test", "live"]),
  reviewedBy: z.string().min(1).max(200),
  checkedAt: z.iso.datetime(),
  effectiveFrom: z.iso.datetime(),
  effectiveUntil: z.iso.datetime(),
  evidence,
  previewSeconds: z.number().int().positive().max(86400),
  proration: z.enum(["remaining_calendar_seconds", "remaining_utc_days"]),
  utcDayCutoff: z
    .enum(["start_of_current_utc_day", "start_of_next_utc_day"])
    .optional(),
  rounding: z.literal("half_up"),
  unusedUnits: z.literal("retain_consumed_add_prorated_difference"),
  inFlightUnengaged: z.enum(["unknown", "pause_outside_target"]),
  nativeProration: z.strictObject({ enabled: z.boolean(), evidence }),
  replacement: z.strictObject({
    enabled: z.boolean(),
    stopOldBeforeCreate: z.literal(true),
    evidence,
  }),
});
export type ReachPolicy = z.infer<typeof reachPolicySchema>;
export function reachFraction(
  start: string,
  end: string,
  at: Date,
  policy: ReachPolicy,
) {
  const day = 86400000,
    s = new Date(start).getTime(),
    e = new Date(end).getTime();
  if (policy.proration === "remaining_calendar_seconds")
    return {
      numerator: BigInt(Math.max(0, e - at.getTime())),
      denominator: BigInt(e - s),
    };
  if (!policy.utcDayCutoff)
    throw new Error("Reviewed UTC day cutoff is required");
  const cutoff =
    Math.floor(at.getTime() / day) +
    (policy.utcDayCutoff === "start_of_next_utc_day" ? 1 : 0);
  return {
    numerator: BigInt(Math.max(0, Math.floor(e / day) - cutoff) * day),
    denominator: BigInt((Math.floor(e / day) - Math.floor(s / day)) * day),
  };
}
export const previewReachSchema = z.strictObject({
  periodId: z.uuid(),
  quoteId: z.uuid(),
  requestKey: z.uuid(),
});
export const reachCommandSchema = z.strictObject({
  changeId: z.uuid(),
  requestKey: z.uuid(),
});
export const reachApprovalSchema = reachCommandSchema.extend({
  accept: z.literal(true),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const reachScopeSchema = z.object({
  markets: z.array(z.string()),
  discovery: allowanceSchema,
  automation: allowanceSchema,
});
export const reachSnapshotSchema = z.object({
  currentFinancial: paymentSnapshotSchema,
  priorChangeId: z.uuid().nullable(),
  sourcePlanId: z.string(),
  consumed: z.object({
    discovery: z.number().int().nonnegative(),
    automation: z.number().int().nonnegative(),
  }),
  version: z.literal(1),
  direction: z.enum(["expansion", "reduction"]),
  path: z.enum(["international_native", "replacement_mandate"]),
  original: paidPeriodSchema,
  action: paymentActionSchema,
  target: paymentSnapshotSchema,
  delta: paymentSnapshotSchema,
  policy: reachPolicySchema,
  effectiveAt: z.iso.datetime(),
  renewalAt: z.iso.datetime(),
  proration: z.object({
    numerator: z.string(),
    denominator: z.string(),
    rounding: z.literal("half_up"),
    basis: reachPolicySchema.shape.proration,
  }),
  scope: reachScopeSchema,
  renewalScope: reachScopeSchema,
  deltaActionId: z.uuid(),
  replacementActionId: z.uuid(),
  deltaOperationKey: z.uuid(),
  replacementOperationKey: z.uuid(),
});
export type ReachSnapshot = z.infer<typeof reachSnapshotSchema>;
export const reachFactSchema = z.object({
  kind: z.enum([
    "preview",
    "checked",
    "withdrawn",
    "approved",
    "attempt",
    "preflight_stopped",
    "native",
    "capture",
    "applied",
    "review",
    "action",
  ]),
  action: z
    .enum(["execute", "refresh", "checkout_mandate", "checkout_delta"])
    .optional(),
  reviewHash: z.string().optional(),
  body: z.record(z.string(), z.json()).optional(),
  stage: z.enum(["update", "stop_old", "mandate", "order"]).optional(),
  reason: z.string().optional(),
  native: z
    .object({
      subscriptionId: z.string().nullable(),
      orderId: z.string().nullable(),
      checkoutUrl: z.url().nullable(),
      oldStopped: z.boolean(),
      mandateReady: z.boolean(),
      updated: z.boolean(),
      planId: z.string(),
      totalCount: z.number().int().positive(),
      remainingCount: z.number().int().nonnegative(),
      deltaRefundedMinor: z.string().regex(/^\d+$/).optional(),
      customerId: z.string(),
    })
    .optional(),
  capture: paymentObservationSchema.optional(),
  periodId: z.uuid().optional(),
});
export type ReachFact = z.infer<typeof reachFactSchema>;
export const reachChangeSchema = z.object({
  mandatePayments: z
    .array(z.object({ paymentId: z.string(), subscriptionId: z.string() }))
    .default([]),
  id: z.uuid(),
  businessId: z.uuid(),
  requestKey: z.uuid(),
  actorId: z.string(),
  at: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  snapshot: reachSnapshotSchema,
  state: z.enum([
    "preview",
    "approved",
    "pending",
    "review_required",
    "applied",
    "withdrawn",
  ]),
  reviewHash: z.string().nullable(),
  events: z.array(
    z.object({
      id: z.uuid(),
      key: z.string(),
      actorId: z.string().nullable(),
      at: z.iso.datetime(),
      fact: reachFactSchema,
    }),
  ),
});
export type ReachChange = z.infer<typeof reachChangeSchema>;
export function reachUnsent(change: ReachChange) {
  if (
    change.events.some(
      (e) =>
        e.fact.kind === "capture" ||
        e.fact.kind === "applied" ||
        (e.fact.native &&
          (e.fact.native.oldStopped ||
            e.fact.native.updated ||
            e.fact.native.orderId ||
            (change.snapshot.path === "replacement_mandate" &&
              e.fact.native.subscriptionId))),
    )
  )
    return false;
  return ["update", "stop_old", "mandate", "order"].every(
    (stage) =>
      change.events.filter(
        (e) => e.fact.stage === stage && e.fact.kind === "attempt",
      ).length <=
      change.events.filter(
        (e) => e.fact.stage === stage && e.fact.kind === "preflight_stopped",
      ).length,
  );
}
export const reachWorkspaceSchema = z.object({
  currentPeriodId: z.uuid().nullable().optional(),
  changes: z.array(reachChangeSchema),
  configuration: z
    .object({ ready: z.boolean(), reasons: z.array(z.string()) })
    .optional(),
});
export const reachCheckoutRequestSchema = reachCommandSchema.extend({
  purpose: z.enum(["mandate", "delta"]),
});
const checkoutBase = z.object({
  script: z.literal("https://checkout.razorpay.com/v1/checkout.js"),
  key: z.string().regex(/^rzp_(test|live)_[A-Za-z0-9]+$/),
  customer_id: z.string().regex(/^cust_[A-Za-z0-9]+$/),
});
export const reachCheckoutSchema = z.discriminatedUnion("kind", [
  checkoutBase.extend({
    kind: z.literal("mandate"),
    subscription_id: z.string().regex(/^sub_[A-Za-z0-9]+$/),
  }),
  checkoutBase.extend({
    kind: z.literal("delta"),
    order_id: z.string().regex(/^order_[A-Za-z0-9]+$/),
    amount: z.string().regex(/^[1-9]\d*$/),
    currency: z.enum(["INR", "USD"]),
  }),
]);
export type ReachCheckout = z.infer<typeof reachCheckoutSchema>;
export type ReachWork = {
  id: string;
  business_id: string;
  recovery_key: string;
};
export type ReachStage = "update" | "stop_old" | "mandate" | "order";
export class ReachEffectNotAttempted extends Error {
  constructor() {
    super("Reach effect was not attempted");
  }
}
export type ReachGateway = {
  intent(change: ReachChange, stage: ReachStage): unknown;
  inspect(change: ReachChange): Promise<ReachFact>;
  effect(
    change: ReachChange,
    stage: ReachStage,
    authorize: () => Promise<void>,
  ): Promise<ReachFact>;
  checkout?(change: ReachChange, purpose: "mandate" | "delta"): unknown;
};
