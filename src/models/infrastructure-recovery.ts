import { z } from "zod";

export const recoveryHash = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.string().regex(/^[a-zA-Z0-9_.:-]{1,150}$/);
export const recoveryStages = [
  "requested",
  "target_verified",
  "restored",
  "secured",
  "verified",
  "quarantined",
  "reconciled",
  "inspection_ready",
] as const;
export type RecoveryStage = (typeof recoveryStages)[number];
export const recoveryStageSchema = z.enum(recoveryStages);
export const recoveryPlanSchema = z
  .strictObject({
    id: z.uuid(),
    businessId: z.uuid(),
    mode: z.enum(["fixture", "configured"]),
    reviewedId: identity,
    reviewedBy: identity,
    schemaHash: recoveryHash,
    backupId: identity,
    backupHash: recoveryHash,
    source: z.strictObject({
      project: identity,
      branch: identity,
      database: identity,
      host: identity,
      bucket: identity,
      worker: identity,
      auth: identity,
      webhook: identity,
    }),
    target: z.strictObject({
      project: identity,
      branch: identity,
      database: identity,
      host: identity,
      bucket: identity,
      worker: identity,
      auth: identity,
      webhook: identity,
      disposable: z.literal(true),
      environment: z.literal("recovery"),
    }),
    cutoff: z.iso.datetime(),
    retainUntil: z.iso.datetime(),
    observationExpiresAt: z.iso.datetime(),
    objectives: z.strictObject({
      rpoSeconds: z.number().int().positive(),
      rtoSeconds: z.number().int().positive(),
      backupRetentionSeconds: z.number().int().positive(),
      fileRetentionSeconds: z.number().int().nonnegative(),
      review: identity,
    }),
    limits: z.strictObject({
      backupBytes: z.number().int().positive().safe(),
      fileBytes: z.number().int().positive().safe(),
      totalFileBytes: z.number().int().nonnegative().safe(),
    }),
    regions: z.strictObject({
      vercel: z.literal("iad1"),
      neon: z.literal("aws-us-east-1"),
      trigger: z.literal("us-east-1"),
      r2: z.literal("us"),
      r2Hint: z.enum(["enam", "none"]),
    }),
    files: z
      .array(
        z.strictObject({
          id: identity,
          hash: recoveryHash,
          bytes: z.number().int().nonnegative(),
          retained: z.boolean(),
        }),
      )
      .max(10000),
    costs: z
      .array(
        z.strictObject({
          id: identity,
          provider: z.enum(["vercel", "neon", "trigger", "r2"]),
          kind: z.enum([
            "commitment",
            "backup",
            "restore",
            "storage",
            "requests",
          ]),
          basis: z.enum([
            "selected_commitment",
            "observed_requests",
            "billed_charge",
          ]),
          status: z.enum(["actual", "estimated", "unpriced"]),
          currency: z.enum(["USD", "INR"]),
          micros: z
            .string()
            .regex(/^\d{1,24}$/)
            .nullable(),
          quantity: z.number().int().nonnegative().max(1e12),
          unit: identity,
          evidence: identity,
          observedAt: z.iso.datetime(),
          freshUntil: z.iso.datetime(),
          retentionSeconds: z.number().int().min(60).max(2147483647),
        }),
      )
      .max(100),
  })
  .superRefine((p, c) => {
    for (const k of [
      "project",
      "branch",
      "host",
      "bucket",
      "worker",
      "auth",
      "webhook",
    ] as const)
      if (p.source[k] === p.target[k])
        c.addIssue({
          code: "custom",
          message: "Recovery identities must be isolated",
          path: ["target", k],
        });
    if (new Date(p.retainUntil) <= new Date(p.cutoff))
      c.addIssue({ code: "custom", message: "Invalid retention" });
    for (const cost of p.costs)
      if ((cost.status === "unpriced") !== (cost.micros === null))
        c.addIssue({
          code: "custom",
          message: "Unpriced usage has no assumed price",
        });
  });
export type RecoveryPlan = z.infer<typeof recoveryPlanSchema>;
export const recoveryRequestSchema = z.strictObject({
  planId: z.uuid(),
  requestKey: z.uuid(),
});
export type RecoveryFacts = { table: string; id: string; hash: string }[];
export const recoveryEvidenceSchema = z.strictObject({
  assurance:z.strictObject({actorId:z.string().min(1).max(150),verifiedAt:z.iso.datetime({offset:true})}).optional(),
  facts: z
    .array(
      z.strictObject({
        table: identity,
        id: z.string().max(150),
        hash: recoveryHash,
      }),
    )
    .optional(),
  files: z
    .array(
      z.strictObject({
        id: identity,
        hash: recoveryHash,
        bytes: z.number().int().nonnegative(),
        status: z.enum(["restored", "omitted"]),
      }),
    )
    .optional(),
  unresolved: z.array(z.string().max(300)).optional(),
  native: z
    .array(
      z.strictObject({
        source: identity,
        id: identity,
        nativeId: identity.nullable(),
        outcome: z.enum(["accepted", "unknown", "stopped"]),
        amountMinor: z.string().regex(/^\d+$/).nullable(),
        currency: z.enum(["INR", "USD"]).nullable(),
      }),
    )
    .optional(),
  durationMs: z.number().nonnegative().optional(),
  physicalTarget: recoveryHash.optional(),
  security: z.literal("restricted-verified").optional(),
  execution: z
    .strictObject({
      project: identity,
      environment: identity,
      worker: identity,
      region: identity.nullable(),
      runId: identity,
    })
    .optional(),
});
export type RecoveryEvidence = z.infer<typeof recoveryEvidenceSchema>;
export const recoveryOutcomeSchema = z.enum([
  "started",
  "completed",
  "failed",
  "ambiguous",
]);
export type RecoveryOperation = {
  id: string;
  businessId: string;
  actorId: string;
  sessionId: string;
  requestKey: string;
  plan: RecoveryPlan;
  planHash: string;
  stage: RecoveryStage;
  at: string;
  events: {
    stage: RecoveryStage;
    outcome: "started" | "completed" | "failed" | "ambiguous";
    at: string;
    evidence: RecoveryEvidence;
  }[];
};
export type RecoveryAdapter = {
  advance(
    plan: RecoveryPlan,
    operationId: string,
    stage: RecoveryStage,
    authorize: () => Promise<void>,
  ): Promise<RecoveryEvidence>;
  inspect(
    plan: RecoveryPlan,
    operationId: string,
  ): Promise<{
    business: { id: string; name: string };
    facts: RecoveryFacts;
    records: { table: string; id: string; value: Record<string, unknown> }[];
    quarantined: true;
  }>;
};
