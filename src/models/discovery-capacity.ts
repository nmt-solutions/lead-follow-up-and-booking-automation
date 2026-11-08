import { paidContractSchema } from "./subscription-payments";
import { z } from "zod";

const slots = z.number().int().min(1).max(100000);
// The declaration can be deployed before its resulting native ID/version exist.
// Only the later MFA-backed policy approval grants execution authority.
export const capacityDeclarationSchema = z
  .strictObject({
    allocationKey: z.uuid(),
    projectRef: z.string().trim().min(1).max(256),
    environmentId: z.string().trim().min(1).max(256),
    deploymentRef: z.string().trim().min(1).max(128),
    providerEvidence: z.string().trim().min(1).max(2000),
    validUntil: z.iso.datetime(),
    total: slots,
    pooled: slots,
    allocations: z
      .array(
        z.strictObject({
          businessId: z.uuid(),
          offerId: z.string().min(1).max(256),
          reservedCapacityId: z.string().min(1).max(256),
          quantity: z.number().int().positive().max(1_000_000_000),
          unit: z.string().trim().min(1).max(256),
          concurrentRuns: slots,
          mappingEvidence: z.string().trim().min(1).max(2000),
        }),
      )
      .max(500),
    fallback: z.literal("wait"),
    maxObservationAgeMs: z.number().int().min(100).max(30000),
  })
  .superRefine((policy, ctx) => {
    if (
      policy.pooled +
        policy.allocations.reduce((n, a) => n + a.concurrentRuns, 0) >
      policy.total
    )
      ctx.addIssue({
        code: "custom",
        message: "Allocations exceed approved provider capacity",
      });
    if (
      new Set(policy.allocations.map((a) => a.businessId)).size !==
      policy.allocations.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Each Business has one allocation",
      });
  });
export const capacityPolicySchema = capacityDeclarationSchema.safeExtend({
  deploymentId: z.string().trim().min(1).max(256),
  deploymentVersion: z.string().trim().min(1).max(256),
});
export type CapacityPolicy = z.infer<typeof capacityPolicySchema>;
export const configureCapacitySchema = z.strictObject({
  requestKey: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
  policy: capacityPolicySchema,
});
export const capacityRouteSchema = z.object({
  policyId: z.uuid(),
  version: z.number().int().positive(),
  allocationKey: z.uuid(),
  projectRef: z.string(),
  environmentId: z.string(),
  deploymentRef: z.string(),
  deploymentId: z.string(),
  deploymentVersion: z.string(),
  mode: z.enum(["pooled", "reserved"]),
  total: slots,
  slots,
  globalLimit: z.string(),
  laneLimit: z.string(),
  contract: paidContractSchema,
  maxObservationAgeMs: z.number(),
});
export type CapacityRoute = z.infer<typeof capacityRouteSchema>;
export const capacityViewSchema = z.object({
  mode: z.enum(["pooled", "reserved"]).nullable(),
  status: z.enum([
    "available",
    "busy",
    "setup_required",
    "unavailable",
    "stale",
    "entitlement_changed",
  ]),
  slots: z.number().int().nonnegative(),
  running: z.number().int().nonnegative().nullable(),
  queued: z.number().int().nonnegative().nullable(),
  observedAt: z.iso.datetime().nullable(),
});
export type CapacityView = z.infer<typeof capacityViewSchema>;
export const capacityRevisionSchema = z.object({
  id: z.uuid(),
  version: z.number(),
  requestKey: z.uuid(),
  actorId: z.string(),
  sessionId: z.string(),
  at: z.iso.datetime(),
  policy: capacityPolicySchema,
});
export const capacityConfigurationSchema = z.object({
  revisions: z.array(capacityRevisionSchema),
});

export const capacityDeploymentSchema = z.strictObject({
  policy: capacityDeclarationSchema,
});
export type CapacityDeployment = z.infer<typeof capacityDeploymentSchema>;
