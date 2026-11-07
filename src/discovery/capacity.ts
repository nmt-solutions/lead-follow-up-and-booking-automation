import { z } from "zod";
import type { createDiscoveryCapacityRepository } from "../db/discovery-capacity-repository";
import {
  capacityDeploymentSchema,
  type CapacityDeployment,
  type CapacityRoute,
  type CapacityView,
} from "../models/discovery-capacity";
import type { Actor } from "../models/business";
import type { DiscoveryWork } from "../models/discovery";
import type { ScheduleWork } from "../models/discovery-schedules";
import { ApplicationError } from "../models/application-error";

export function capacityLimits(deployment: CapacityDeployment) {
  return [
    {
      name: `discovery-provider-${deployment.policy.allocationKey}`,
      total: deployment.policy.total,
    },
    {
      name: `discovery-pooled-${deployment.policy.allocationKey}`,
      total: deployment.policy.pooled,
    },
    ...deployment.policy.allocations.map((a) => ({
      name: `discovery-reserved-${deployment.policy.allocationKey}-${a.businessId}`,
      total: a.concurrentRuns,
    })),
  ];
}
export function capacityDeployment(environment: NodeJS.ProcessEnv) {
  try {
    const parsed = capacityDeploymentSchema.safeParse(
      JSON.parse(environment.DISCOVERY_CAPACITY_DEPLOYMENT_JSON ?? "null"),
    );
    return parsed.success &&
      parsed.data.policy.projectRef === environment.TRIGGER_PROJECT_REF
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}
const observedLimit = z.object({
  name: z.string(),
  paused: z.boolean(),
  total: z.object({
    current: z.number().int().nonnegative().nullable(),
    base: z.number().int().nonnegative().nullable(),
    override: z.number().nullable(),
  }),
  perKey: z.object({ current: z.number().nullable() }),
  running: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
});
/** Availability is observed, never a throughput promise. Unknown enqueue acceptance
 * retains the same binding and global native idempotency key on every retry. */
export function createCapacityDiscoveryQueue(options: {
  deployment: CapacityDeployment;
  repository: ReturnType<typeof createDiscoveryCapacityRepository>;
  execution?: {
    project: { ref: string };
    environment: { id: string };
    deployment?: { id: string; version: string; externalId?: string };
  };
  native: {
    key(value: string): Promise<string>;
    retrieve(name: string): Promise<unknown>;
    queue(): Promise<unknown>;
    deployment(): Promise<unknown>;
    trigger(
      task: string,
      payload: unknown,
      options: {
        concurrency?: string[];
        idempotencyKey: string;
        idempotencyKeyTTL?: string;
        delay?: Date;
        version?: string;
      },
    ): Promise<unknown>;
  };
}) {
  const { repository, native, deployment } = options;
  async function observe(route: CapacityRoute) {
    if (
      route.allocationKey !== deployment.policy.allocationKey ||
      route.projectRef !== deployment.policy.projectRef ||
      route.environmentId !== deployment.policy.environmentId ||
      route.deploymentRef !== deployment.policy.deploymentRef
    )
      throw new Error("Discovery capacity deployment is unavailable");
    if (
      options.execution &&
      (options.execution.project.ref !== route.projectRef ||
        options.execution.environment.id !== route.environmentId ||
        options.execution.deployment?.id !== route.deploymentId ||
        options.execution.deployment.version !== route.deploymentVersion ||
        options.execution.deployment.externalId !== route.deploymentRef)
    )
      throw new Error("Discovery worker identity is unavailable");
    const limits = [
      ...capacityLimits(deployment),
      {
        name: "task/bounded-prospect-discovery",
        total: deployment.policy.total,
      },
    ];
    // Verify EVERY partition, including an unused reserved allocation. Observing
    // only this lane cannot establish that pooled jobs leave reserved capacity.
    const results = await Promise.allSettled([
      native.queue(),
      native.deployment(),
      ...limits.map((expected) => native.retrieve(expected.name)),
    ]);
    const queueResult = results[0];
    if (queueResult.status !== "fulfilled")
      throw new Error("Discovery queue is unavailable");
    z.object({
      name: z.literal("bounded-prospect-discovery"),
      type: z.literal("task"),
      version: z.literal("V2"),
      concurrencyLimit: z.null(),
      paused: z.literal(false),
    }).parse(queueResult.value);
    const deploymentResult = results[1];
    if (deploymentResult.status !== "fulfilled")
      throw new Error("Discovery deployment is unavailable");
    z.object({
      id: z.literal(route.deploymentId),
      version: z.literal(route.deploymentVersion),
      externalId: z.literal(route.deploymentRef),
      status: z.literal("DEPLOYED"),
    }).parse(deploymentResult.value);
    const observations = limits.map((expected, index) => {
      const result = results[index + 2];
      if (result.status !== "fulfilled")
        throw new Error("Discovery capacity is unavailable");
      const observed = observedLimit.parse(result.value);
      if (
        observed.name !== expected.name ||
        observed.total.current !== expected.total ||
        observed.total.base !== expected.total ||
        observed.total.override !== null ||
        observed.perKey.current !== null ||
        observed.paused
      )
        throw new Error("Discovery capacity bounds are unavailable");
      return observed;
    });
    const lane = observations.find((o) => o.name === route.laneLimit);
    if (!lane) throw new Error("Discovery capacity allocation is unavailable");
    return {
      lane,
      busy: observations.some(
        (o) =>
          o.running >= (o.total.current ?? 0) &&
          (o.name === route.globalLimit ||
            o.name === "task/bounded-prospect-discovery" ||
            o.name === route.laneLimit),
      ),
    };
  }
  async function ready(work: DiscoveryWork, executing = false) {
    const plan = await repository.plan(work, deployment);
    if (!plan) throw new Error("Discovery capacity setup is required");
    if (executing && work.capacityPolicyId !== plan.route.policyId)
      throw new ApplicationError("DISCOVERY_SCOPE_INVALID");
    await observe(plan.route);
    // All current actor, paid contract, stop state and trusted-time checks happen
    // again after native I/O and Business locks, immediately before the effect.
    if (!(await repository.confirm(work, plan, deployment)))
      throw new Error("Discovery capacity observation is stale");
    return plan;
  }
  return {
    capacity: {
      authorize: (work: DiscoveryWork) => ready(work, true),
      async workspace(actor: Actor, businessId: string): Promise<CapacityView> {
        const snapshot = await repository.route(actor, businessId, deployment);
        const route = snapshot.route;
        if (!route)
          return {
            mode: null,
            status: "setup_required",
            slots: 0,
            running: null,
            queued: null,
            observedAt: null,
          };
        try {
          const observed = await observe(route);
          const current = await repository.route(actor, businessId, deployment);
          if (
            !current.route ||
            JSON.stringify(current.route) !== JSON.stringify(route)
          )
            return {
              mode: route.mode,
              status: "entitlement_changed",
              slots: route.slots,
              running: null,
              queued: null,
              observedAt: null,
            };
          if (
            new Date(current.at).getTime() - new Date(snapshot.at).getTime() >
            route.maxObservationAgeMs
          )
            return {
              mode: route.mode,
              status: "stale",
              slots: route.slots,
              running: null,
              queued: null,
              observedAt: null,
            };
          return {
            mode: route.mode,
            status: observed.busy ? "busy" : "available",
            slots: route.slots,
            running: observed.lane.running,
            queued: observed.lane.queued,
            observedAt: current.at,
          };
        } catch (error: unknown) {
          if (error instanceof ApplicationError) throw error;
          return {
            mode: route.mode,
            status: "unavailable",
            slots: route.slots,
            running: null,
            queued: null,
            observedAt: null,
          };
        }
      },
    },
    async enqueue(work: DiscoveryWork) {
      const plan = await ready(work);
      const route = plan.route;
      const idempotencyKey = await native.key(
        `discovery-${work.runId}-${work.executionKey}`,
      );
      // Key creation is external SDK I/O too: recheck authority after it.
      if (!(await repository.confirm(work, plan, deployment)))
        throw new Error("Discovery capacity observation is stale");
      await native.trigger(
        "bounded-prospect-discovery",
        { ...work, capacityPolicyId: route.policyId },
        {
          concurrency: [route.globalLimit, route.laneLimit],
          idempotencyKey,
          idempotencyKeyTTL: "30d",
          version: route.deploymentVersion,
        },
      );
    },
    async schedule(work: ScheduleWork) {
      await native.trigger("scheduled-prospect-discovery", work, {
        delay: new Date(work.dueAt),
        idempotencyKey: await native.key(
          `discovery-schedule-${work.scheduleId}-${work.revision}-${work.dueAt}`,
        ),
      });
    },
  };
}
