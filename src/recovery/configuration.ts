import { z } from "zod";
import {
  recoveryPlanSchema,
  type RecoveryPlan,
} from "../models/infrastructure-recovery";
import { ApplicationError } from "../models/application-error";
import { recoveryDigest } from "./postgres";

export const recoveryInventorySchema = z.strictObject({
  planId: z.uuid(),
  configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime(),
  vercel: z.strictObject({
    project: z.string().min(1),
    environment: z.enum(["production", "preview", "development"]),
    deployment: z.string().min(1),
    region: z.literal("iad1"),
  }),
  trigger: z.strictObject({
    project: z.string().min(1),
    environment: z.string().min(1),
    worker: z.string().min(1),
    selectedRegion: z.literal("us-east-1"),
    observedRun: z.string().nullable(),
    observedRegion: z.string().nullable(),
    evidence: z.string().min(1).max(150),
  }),
  storage: z.strictObject({
    account: z.string().regex(/^[a-f0-9]{32}$/),
    sourceBucket: z.string().regex(/^[a-z0-9-]{3,63}$/),
    targetBucket: z.string().regex(/^[a-z0-9-]{3,63}$/),
    backupBucket: z.string().regex(/^[a-z0-9-]{3,63}$/),
    jurisdiction: z.literal("us"),
    private: z.literal(true),
    retainedCopies: z.boolean(),
    evidence: z.string().min(1).max(150),
  }),
  isolationEvidence: z.string().min(1).max(150),
  commercialApproval: z.string().min(1).max(150),
  nativeTools: z.strictObject({
    postgresMajor: z.number().int().min(14).max(99),
    pgDumpHash: z.string().regex(/^[a-f0-9]{64}$/),
    pgRestoreHash: z.string().regex(/^[a-f0-9]{64}$/),
    psqlHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});
export type RecoveryInventory = z.infer<typeof recoveryInventorySchema>;
export const recoveryConfigurationHash = (plan: RecoveryPlan) =>
  recoveryDigest(
    JSON.stringify({
      source: plan.source,
      target: plan.target,
      regions: plan.regions,
    }),
  );
export function configuredRecoveryPlans(
  env: Record<string, string | undefined>,
) {
  if (!env.RECOVERY_APPROVED_PLANS) return [];
  try {
    if (
      !env.RECOVERY_APPROVED_PLANS_HASH ||
      recoveryDigest(env.RECOVERY_APPROVED_PLANS) !==
        env.RECOVERY_APPROVED_PLANS_HASH
    )
      throw Error();
    return z
      .array(recoveryPlanSchema)
      .max(100)
      .parse(JSON.parse(env.RECOVERY_APPROVED_PLANS));
  } catch {
    throw new ApplicationError("SETUP_REQUIRED");
  }
}
export function configuredRecoveryInventories(
  env: Record<string, string | undefined>,
) {
  if (!env.RECOVERY_APPROVED_INVENTORIES) return [];
  try {
    return z
      .array(recoveryInventorySchema)
      .max(100)
      .parse(JSON.parse(env.RECOVERY_APPROVED_INVENTORIES));
  } catch {
    throw new ApplicationError("SETUP_REQUIRED");
  }
}
export async function observeRecoveryIdentities(d: {
  plan: RecoveryPlan;
  inventory: RecoveryInventory;
  token: string;
  fetch: typeof fetch;
  now(): Date;
}) {
  const { plan, inventory } = d;
  if (
    inventory.planId !== plan.id ||
    recoveryDigest(JSON.stringify(inventory)) !== plan.inventoryHash ||
    inventory.configurationHash !== recoveryConfigurationHash(plan) ||
    new Date(inventory.expiresAt) <= d.now() ||
    inventory.storage.sourceBucket !== plan.source.bucket ||
    inventory.storage.targetBucket !== plan.target.bucket ||
    inventory.storage.backupBucket === plan.source.bucket ||
    inventory.storage.backupBucket === plan.target.bucket
  )
    throw new ApplicationError("SETUP_REQUIRED");
  async function get(path: string) {
    try {
      const response = await d.fetch(
        `https://console.neon.tech/api/v2${path}`,
        {
          headers: { authorization: `Bearer ${d.token}` },
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) throw Error();
      const text = await response.text();
      if (text.length > 2_000_000) throw Error();
      return JSON.parse(text) as unknown;
    } catch {
      throw new ApplicationError("PROVIDER_UNAVAILABLE");
    }
  }
  for (const identity of [plan.source, plan.target]) {
    const project = z
      .object({ project: z.object({ id: z.string(), region_id: z.string() }) })
      .parse(await get(`/projects/${encodeURIComponent(identity.project)}`));
    const endpoints = z
      .object({
        endpoints: z.array(
          z.object({
            host: z.string(),
            region_id: z.string(),
            branch_id: z.string(),
            project_id: z.string(),
            type: z.string(),
          }),
        ),
      })
      .parse(
        await get(
          `/projects/${encodeURIComponent(identity.project)}/branches/${encodeURIComponent(identity.branch)}/endpoints`,
        ),
      );
    if (
      project.project.id !== identity.project ||
      project.project.region_id !== plan.regions.neon ||
      !endpoints.endpoints.some(
        (e) =>
          e.host === identity.host &&
          e.branch_id === identity.branch &&
          e.project_id === identity.project &&
          e.region_id === plan.regions.neon &&
          e.type === "read_write",
      )
    )
      throw new ApplicationError("FORBIDDEN");
  }
  return {
    source: plan.source,
    target: plan.target,
    expiresAt: inventory.expiresAt,
    nativeVerified: true as const,
  };
}
export function recoveryReadiness(
  plans: RecoveryPlan[],
  inventories: RecoveryInventory[],
  env: Record<string, string | undefined>,
  now: Date,
) {
  return plans.map((plan) => {
    const inventory = inventories.find(
      (i) =>
        i.planId === plan.id &&
        recoveryDigest(JSON.stringify(i)) === plan.inventoryHash &&
        i.configurationHash === recoveryConfigurationHash(plan),
    );
    const fresh = Boolean(
      inventory &&
      new Date(inventory.expiresAt) > now &&
      new Date(plan.observationExpiresAt) > now,
    );
    return {
      planId: plan.id,
      cutoff: plan.cutoff,
      freshUntil: inventory?.expiresAt ?? null,
      selected: plan.regions,
      vercel: {
        status:
          inventory &&
          env.VERCEL_PROJECT_ID === inventory.vercel.project &&
          env.VERCEL_ENV === inventory.vercel.environment &&
          env.VERCEL_DEPLOYMENT_ID === inventory.vercel.deployment &&
          env.VERCEL_REGION === plan.regions.vercel
            ? "native_runtime_observed"
            : "unverified",
        next: "Deploy the selected project/environment in iad1 and compare the native runtime deployment identity.",
      },
      neon: {
        status: "requires_native_read",
        next: "Worker must read both exact Neon projects, branches and read-write endpoint hosts before any target operation.",
      },
      trigger: {
        status:
          inventory?.trigger.observedRun &&
          inventory.trigger.observedRegion === plan.regions.trigger
            ? "attested_run_observation"
            : "selected",
        next: "Select us-east-1 in the project Regions page; recovery triggers explicitly request it. Review the actual run region. Payload/log storage placement is separate.",
      },
      r2: {
        status: inventory ? "attested_private_us" : "unverified",
        next: "Verify private US-jurisdiction buckets and separate retained copies. Eastern location hints are best effort; no Virginia or S3 versioning guarantee.",
      },
      fresh,
      launchGates: [
        ...(!fresh
          ? ["Renew the exact environment/isolation/retention observation"]
          : []),
        ...(!env.TRIGGER_RECOVERY_SECRET_KEY
          ? ["Configure the isolated recovery worker credentials"]
          : []),
        "Verify actual commercial plans and retention windows",
        "Complete a configured isolated restore and review its current security/native outcome evidence",
        "Fresh target authorization is required before external work can resume",
      ],
    };
  });
}
