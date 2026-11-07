import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import type { WorkIdentity } from "../models/discovery";
import type { createRecoveryRepository } from "../db/recovery-repository";
import type { createCostApplication } from "./costs";
import { recoveryCostSource } from "../recovery/costs";
import { isDeepStrictEqual } from "node:util";
import type { recoveryReadiness } from "../recovery/configuration";
import {
  recoveryPlanSchema,
  recoveryEvidenceSchema,
  recoveryRequestSchema,
  recoveryStages,
  type RecoveryPlan,
  type RecoveryAdapter,
  type RecoveryOperation,
  type RecoveryEvidence,
} from "../models/infrastructure-recovery";

function publicOperation(r: RecoveryOperation) {
  return {
    id: r.id,
    businessId: r.businessId,
    actorId: r.actorId,
    requestKey: r.requestKey,
    plan: r.plan,
    planHash: r.planHash,
    stage: r.stage,
    at: r.at,
    events: r.events,
  };
}

export function createRecoveryApplication<C>(d: {
  authenticate(credentials: C): Promise<WorkIdentity>;
  repository: ReturnType<typeof createRecoveryRepository>;
  plans: RecoveryPlan[];
  adapter: RecoveryAdapter | null;
  costs?: Pick<
    ReturnType<typeof createCostApplication<C>>,
    "workspace" | "record"
  >;
  queue?: { enqueue(operationId: string): Promise<void> };
  readiness?: () => ReturnType<typeof recoveryReadiness>;
  executionEvidence?: RecoveryEvidence["execution"];
  setupIssues?: string[];
}) {
  async function actor(c: C) {
    const a = await d.authenticate(c);
    await d.repository.authorize(a);
    return a;
  }
  return {
    async reconcileCosts(c: C, input: unknown) {
      await actor(c);
      const parsed = z.strictObject({ planId: z.uuid() }).safeParse(input);
      if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
      const plan = d.plans.find((p) => p.id === parsed.data.planId);
      if (!plan || !d.costs) throw new ApplicationError("SETUP_REQUIRED");
      for (const cost of plan.costs) {
        const sourceId = `evidence:recovery:${cost.id}`,
          source = recoveryCostSource(plan, cost),
          state = await d.costs.workspace(c, source.month),
          previous = state.history
            .filter((r) => r.sourceId === sourceId)
            .at(-1);
        if (previous) {
          if (!isDeepStrictEqual(previous.source, source))
            throw new ApplicationError("CONFLICT");
          continue;
        }
        try {
          await d.costs.record(c, {
            sourceId,
            expectedVersion: 0,
            source,
            reason: cost.evidence,
            retentionSeconds: cost.retentionSeconds,
          });
        } catch (error: unknown) {
          if (!(error instanceof ApplicationError) || error.code !== "CONFLICT")
            throw error;
          const current = (await d.costs.workspace(c, source.month)).history
            .filter((r) => r.sourceId === sourceId)
            .at(-1);
          if (!current || !isDeepStrictEqual(current.source, source))
            throw error;
        }
      }
      return { reconciled: plan.costs.length };
    },
    async workspace(c: C) {
      const a = await actor(c);
      const operations = [];
      for (const businessId of new Set(d.plans.map((p) => p.businessId)))
        operations.push(...(await d.repository.list(a, businessId)));
      const current = operations.filter((o) =>
        d.plans.some((p) => isDeepStrictEqual(p, o.plan)),
      );
      const readiness = d.readiness?.() ?? [];
      return {
        configured: Boolean((d.adapter || d.queue) && d.plans.length),
        productionVerified: false as const,
        setupIssues: d.setupIssues ?? [],
        configuredDrillVerified: current.some(
          (o) =>
            o.plan.mode === "configured" &&
            readiness.some((r) => r.planId === o.plan.id && r.fresh) &&
            o.events.some(
              (e) => e.stage === "verified" && e.outcome === "completed",
            ),
        ),
        readiness: readiness.map((r) => {
          const evidence = current
            .filter(
              (o) => o.plan.id === r.planId && o.plan.mode === "configured",
            )
            .flatMap((o) => o.events)
            .filter((e) => e.outcome === "completed");
          return {
            ...r,
            neon: {
              ...r.neon,
              status:
                r.fresh && evidence.some((e) => e.evidence.physicalTarget)
                  ? "native_endpoints_observed"
                  : r.neon.status,
            },
            trigger: {
              ...r.trigger,
              status:
                r.fresh &&
                evidence.some(
                  (e) => e.evidence.execution?.region === "us-east-1",
                )
                  ? "native_run_observed"
                  : r.trigger.status,
            },
          };
        }),
        plans: d.plans.map((p) => ({
          id: p.id,
          businessId: p.businessId,
          mode: p.mode,
          reviewedId: p.reviewedId,
          cutoff: p.cutoff,
          objectives: p.objectives,
          limits: p.limits,
          regions: p.regions,
          files: p.files,
          costs: p.costs,
        })),
        operations: operations.map(publicOperation),
      };
    },
    async request(c: C, input: unknown) {
      const a = await actor(c),
        v = recoveryRequestSchema.safeParse(input);
      if (!v.success) throw new ApplicationError("INVALID_INPUT");
      const plan = d.plans.find((p) => p.id === v.data.planId);
      if (!plan || !(d.adapter || d.queue))
        throw new ApplicationError("SETUP_REQUIRED");
      const saved = await d.repository.request(
        a,
        recoveryPlanSchema.parse(plan),
        v.data.requestKey,
      );
      await d.queue?.enqueue(saved.id);
      return publicOperation(saved);
    },
    async run(c: C, input: unknown) {
      const v = z
        .strictObject({ businessId: z.uuid(), operationId: z.uuid() })
        .safeParse(input);
      if (!v.success) throw new ApplicationError("INVALID_INPUT");
      const a = await actor(c);
      let r = await d.repository.get(a, v.data.businessId, v.data.operationId);
      const plan = d.plans.find((p) => p.id === r.plan.id);
      if (
        !plan ||
        JSON.stringify(recoveryPlanSchema.parse(plan)) !==
          JSON.stringify(r.plan) ||
        !(d.adapter || d.queue)
      )
        throw new ApplicationError("SETUP_REQUIRED");
      if (r.actorId !== a.userId) throw new ApplicationError("FORBIDDEN");
      if (!d.adapter) {
        await d.repository.delegate(a, r.businessId, r.id);
        await d.queue!.enqueue(r.id);
        return publicOperation(r);
      }
      if (r.stage === "inspection_ready") return publicOperation(r);
      const key = await d.repository.claim(a, r.businessId, r.id);
      if (!key) return publicOperation(r);
      r = await d.repository.get(a, r.businessId, r.id);
      const stage = recoveryStages[recoveryStages.indexOf(r.stage) + 1];
      if (!stage) throw new ApplicationError("CONFLICT");
      try {
        const proof = recoveryEvidenceSchema.parse(
          await d.adapter.advance(plan, r.id, stage, () =>
            d.repository.authorize(a, r.businessId),
          ),
        );
        await d.repository.authorize(a, r.businessId);
        await d.repository.finish(
          a,
          r.businessId,
          r.id,
          key,
          stage,
          "completed",
          {
            ...proof,
            ...(d.executionEvidence ? { execution: d.executionEvidence } : {}),
          },
        );
      } catch (error: unknown) {
        await d.repository.finish(
          a,
          r.businessId,
          r.id,
          key,
          r.stage,
          "ambiguous",
          {},
        );
        if (error instanceof ApplicationError) throw error;
        throw new ApplicationError("PROVIDER_UNAVAILABLE");
      }
      r = await d.repository.get(a, r.businessId, r.id);
      return publicOperation(r);
    },
    async inspect(c: C, input: unknown) {
      const v = z
        .strictObject({ businessId: z.uuid(), operationId: z.uuid() })
        .safeParse(input);
      if (!v.success) throw new ApplicationError("INVALID_INPUT");
      const a = await actor(c),
        r = await d.repository.get(a, v.data.businessId, v.data.operationId);
      if (!d.adapter || !recoveryStages.slice(4).includes(r.stage))
        throw new ApplicationError("CONFLICT");
      const result = await d.adapter.inspect(r.plan, r.id);
      await d.repository.authorize(a, r.businessId);
      return result;
    },
  };
}
