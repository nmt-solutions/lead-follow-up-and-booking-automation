import type { createCapacityDiscoveryQueue } from "../discovery/capacity";
import {
  saveScheduleSchema,
  scheduleCommandSchema,
  scheduleWorkSchema,
  type ScheduleWork,
  type DurableAttempt,
} from "../models/discovery-schedules";
import { Cause, Effect, Exit } from "effect";
import { businessIdSchema, type Actor, type Clock } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  startDiscoverySchema,
  allowanceApprovalSchema,
  resumeDiscoverySchema,
  cancelDiscoverySchema,
  type DiscoveryCommand,
  workSchema,
  type DiscoveryProvider,
  type DiscoveryWork,
  type WorkIdentity,
  type StopReason,
} from "../models/discovery";
import type { DiscoveryRepository } from "../discovery/repository";
import {
  discover,
  DiscoveryServices,
  DiscoveryFailure,
  owned,
  exitReason,
} from "../discovery/workflow";
import type { z } from "zod";

function validate<T>(schema: z.ZodType<T>, value: unknown) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
  return parsed.data;
}

// Conventional hosts execute composable discovery Effects here, preserving Exit
// taxonomy and never serializing a Cause, raw provider exception, or task payload.
export function createDiscoveryApplication<Credentials>(dependencies: {
  authenticate(credentials: Credentials): Promise<Actor>;
  authenticateForWork(credentials: Credentials): Promise<WorkIdentity>;
  authenticateWork(identity: WorkIdentity): Promise<Actor>;
  repository: DiscoveryRepository;
  clock: Clock;
  provider: DiscoveryProvider | null;
  queue: {
    capacity?: ReturnType<typeof createCapacityDiscoveryQueue>["capacity"];
    enqueue(work: DiscoveryWork): Promise<void>;
    schedule?(work: ScheduleWork): Promise<void>;
  } | null;
  requireCapacity?: boolean;
  reportFailure?(diagnostic: {
    businessId: string;
    runId: string;
    code: StopReason;
  }): void;
}) {
  const { repository, clock } = dependencies;
  async function publish(
    actor?: Actor,
    businessId?: string,
    target?: { businessId: string; dispatchId: string },
  ) {
    const pending = (
      await repository.pendingDispatches(actor, businessId)
    ).filter(
      (item) =>
        !target ||
        (item.id === target.dispatchId &&
          item.payload.work.businessId === target.businessId),
    );
    let failed = false;
    for (const item of pending) {
      let accepted = false;
      try {
        await dependencies.authenticateWork(item.payload.work);
        if (!(await repository.dispatchable(item.payload))) {
          await repository.dispatchResult(item.id, true);
          continue;
        }
        if (!dependencies.queue) throw new Error("Worker not configured");
        if (item.payload.kind === "schedule") {
          if (!dependencies.queue.schedule)
            throw new Error("Scheduler not configured");
          await dependencies.queue.schedule(item.payload.work);
        } else await dependencies.queue.enqueue(item.payload.work);
        accepted = true;
      } catch (error: unknown) {
        if (error instanceof ApplicationError) {
          const reason =
            error.code === "DISCOVERY_SCOPE_INVALID" ||
            error.code === "DISCOVERY_SETUP_REQUIRED"
              ? "configuration_changed"
              : "authorization_revoked";
          if (item.payload.kind === "schedule")
            await repository.failSchedule(
              item.payload.work,
              reason,
              clock.now(),
            );
          else await repository.finish(item.payload.work, reason, clock.now());
          accepted = true;
        } else failed = true;
      }
      await repository.dispatchResult(item.id, accepted);
    }
    return { failed, processed: pending.length };
  }
  async function command(
    credentials: Credentials,
    id: unknown,
    input: DiscoveryCommand,
  ) {
    const actor = await dependencies.authenticateForWork(credentials);
    const businessId = validate(businessIdSchema, id);
    if (input.action === "resume") {
      const state = await repository.workspace(actor, businessId);
      if (!state.canRun) throw new ApplicationError("FORBIDDEN");
      if (
        !dependencies.provider ||
        !dependencies.queue ||
        state.policy?.adapterId !== dependencies.provider.id
      )
        throw new ApplicationError("DISCOVERY_SETUP_REQUIRED");
      if (state.policy && dependencies.provider.setup?.(state.policy).length)
        throw new ApplicationError("DISCOVERY_SETUP_REQUIRED");
    }
    const result = await repository.command(
      actor,
      businessId,
      input,
      clock.now(),
    );
    if (result.work && (await publish(actor, businessId)).failed)
      throw new ApplicationError("PROVIDER_UNAVAILABLE");
    return { id: result.id, status: result.status };
  }
  async function workspace(credentials: Credentials, id: unknown) {
    const actor = await dependencies.authenticate(credentials);
    const capacity = await dependencies.queue?.capacity?.workspace(
      actor,
      validate(businessIdSchema, id),
    );
    if (capacity) {
      const current = await dependencies.authenticate(credentials);
      if (current.userId !== actor.userId)
        throw new ApplicationError("FORBIDDEN");
    }
    // Read private source/evidence state only after native I/O and current
    // original-session authorization. A revoked read must not return old data.
    const state = await repository.workspace(
      actor,
      validate(businessIdSchema, id),
    );
    state.schedules = await repository.schedules(
      actor,
      validate(businessIdSchema, id),
    );
    if (
      !dependencies.provider ||
      state.policy?.adapterId !== dependencies.provider.id
    )
      state.setup.push(
        "Approved search/AI adapter is not activated. Exa contract and live adapter configuration are required.",
      );
    if (!dependencies.queue)
      state.setup.push("Durable discovery worker is not configured.");
    if (state.policy)
      state.setup.push(
        ...(dependencies.provider?.setup?.(
          state.policy,
          state.brief ?? undefined,
        ) ?? []),
      );
    if (!dependencies.queue?.schedule)
      state.setup.push(
        "Saved-search scheduling and dispatch recovery are not configured.",
      );
    if (capacity) {
      state.capacity = capacity;
      if (!["available", "busy"].includes(state.capacity.status))
        state.setup.push(
          "Discovery execution capacity requires current operator approval, paid entitlement and verified worker deployment. Existing work remains available.",
        );
    }
    if (dependencies.requireCapacity && !state.capacity)
      state.capacity = {
        mode: null,
        status: "setup_required",
        slots: 0,
        running: null,
        queued: null,
        observedAt: null,
      };
    return state;
  }
  return {
    async saveSchedule(credentials: Credentials, id: unknown, input: unknown) {
      const actor = await dependencies.authenticateForWork(credentials);
      const businessId = validate(businessIdSchema, id);
      const request = validate(saveScheduleSchema, input);
      const state = await repository.workspace(actor, businessId);
      if (
        state.policy?.exa &&
        state.brief &&
        dependencies.provider?.setup?.(state.policy, {
          ...state.brief,
          publicOffering: request.search.publicOffering,
          markets: request.search.markets,
        }).length
      )
        throw new ApplicationError("DISCOVERY_SCOPE_INVALID");
      const result = await repository.saveSchedule(
        actor,
        businessId,
        request,
        clock.now(),
      );
      await publish(actor, businessId);
      return result;
    },
    async scheduleCommand(
      credentials: Credentials,
      id: unknown,
      input: unknown,
    ) {
      const actor = await dependencies.authenticateForWork(credentials);
      const businessId = validate(businessIdSchema, id);
      const result = await repository.scheduleCommand(
        actor,
        businessId,
        validate(scheduleCommandSchema, input),
        clock.now(),
      );
      await publish(actor, businessId);
      return result;
    },
    async dispatchScheduled(payload: unknown) {
      const work = validate(scheduleWorkSchema, payload);
      try {
        await dependencies.authenticateWork(work);
        if (!dependencies.provider || !dependencies.queue) {
          await repository.failSchedule(work, "setup_required", clock.now());
          return { outcome: "setup_required" };
        }
        const result = await repository.due(
          work,
          clock.now(),
          dependencies.provider.id,
        );
        if (result.outcome === "queued" || result.outcome.endsWith("skipped"))
          await publish(work, work.businessId);
        return result;
      } catch (error: unknown) {
        if (!(error instanceof ApplicationError))
          throw new Error("Scheduled discovery dispatch failed");
        const reason =
          error.code === "DISCOVERY_SCOPE_INVALID"
            ? "configuration_changed"
            : error.code === "DISCOVERY_SETUP_REQUIRED"
              ? "setup_required"
              : "authorization_revoked";
        await repository.failSchedule(work, reason, clock.now());
        return { outcome: reason };
      }
    },
    recoverDispatches: (target?: { businessId: string; dispatchId: string }) =>
      publish(undefined, undefined, target),
    async stopSchedule(payload: unknown) {
      const work = validate(scheduleWorkSchema, payload);
      await repository.failSchedule(work, "worker_lost", clock.now());
    },
    workspace,
    approveAllowance(credentials: Credentials, id: unknown, input: unknown) {
      return command(credentials, id, {
        ...validate(allowanceApprovalSchema, input),
        action: "increase",
      });
    },
    resume(credentials: Credentials, id: unknown, input: unknown) {
      return command(credentials, id, {
        ...validate(resumeDiscoverySchema, input),
        action: "resume",
      });
    },
    cancel(credentials: Credentials, id: unknown, input: unknown) {
      return command(credentials, id, {
        ...validate(cancelDiscoverySchema, input),
        action: "cancel",
      });
    },
    async start(credentials: Credentials, id: unknown, input: unknown) {
      const actor = await dependencies.authenticateForWork(credentials);
      const businessId = validate(businessIdSchema, id);
      const request = validate(startDiscoverySchema, input);
      const state = await repository.workspace(actor, businessId);
      if (!state.canRun) throw new ApplicationError("FORBIDDEN");
      if (
        !dependencies.provider ||
        !dependencies.queue ||
        state.policy?.adapterId !== dependencies.provider.id
      )
        throw new ApplicationError("DISCOVERY_SETUP_REQUIRED");
      if (state.policy && dependencies.provider.setup?.(state.policy).length)
        throw new ApplicationError("DISCOVERY_SETUP_REQUIRED");
      if (
        state.policy &&
        state.brief &&
        dependencies.provider.setup?.(state.policy, {
          ...state.brief,
          publicOffering: request.publicOffering,
          markets: request.markets,
        }).length
      )
        throw new ApplicationError("DISCOVERY_SCOPE_INVALID");
      const exit = await Effect.runPromiseExit(
        owned(() => repository.create(actor, businessId, request, clock.now())),
      );
      if (Exit.isFailure(exit)) {
        const failure = Cause.findErrorOption(exit.cause);
        if (failure._tag === "Some") throw failure.value;
        throw new Error("Discovery creation failed");
      }
      const { run } = exit.value;
      if (run.status === "queued" && (await publish(actor, businessId)).failed)
        throw new ApplicationError("PROVIDER_UNAVAILABLE");
      return { id: run.id, status: run.status };
    },
    async execute(
      payload: unknown,
      options: { signal?: AbortSignal; durable?: DurableAttempt } = {},
    ) {
      const work = validate(workSchema, payload);
      // Unavailable native observation retries under Trigger without claiming or spending.
      if (dependencies.requireCapacity && !dependencies.queue?.capacity)
        throw new Error("Discovery capacity setup is required");
      try {
        await dependencies.queue?.capacity?.authorize(work);
      } catch (error: unknown) {
        if (!(error instanceof ApplicationError))
          throw new Error(
            "Discovery capacity is unavailable; retry the same durable work",
          );
        const reason =
          error.code === "DISCOVERY_SCOPE_INVALID"
            ? "configuration_changed"
            : "authorization_revoked";
        await repository.finish(work, reason, clock.now());
        return { outcome: reason };
      }
      let run;
      try {
        await dependencies.authenticateWork(work);
        run = await repository.claim(work, clock.now(), options.durable);
      } catch (error: unknown) {
        const reason: StopReason =
          error instanceof ApplicationError
            ? error.code === "DISCOVERY_SCOPE_INVALID"
              ? "configuration_changed"
              : "authorization_revoked"
            : "defect";
        await repository.finish(work, reason, clock.now());
        if (reason === "defect") throw new Error("Discovery worker failed");
        return { outcome: reason };
      }
      if (!run) return { outcome: "already_claimed" };
      const provider = dependencies.provider;
      if (
        !provider ||
        provider.id !== run.policy.adapterId ||
        provider.setup?.(run.policy, run.brief).length
      ) {
        await repository.finish(work, "configuration_changed", clock.now());
        return { outcome: "configuration_changed" };
      }
      const deadline = new AbortController();
      const remaining =
        run.policy.deadlineMs -
        (clock.now().getTime() -
          (run.attemptStartedAt ?? clock.now()).getTime());
      if (remaining <= 0) {
        await repository.finish(work, "interrupted", clock.now());
        return { outcome: "interrupted" };
      }
      const timer = setTimeout(() => deadline.abort(), remaining);
      const signal = options.signal
        ? AbortSignal.any([options.signal, deadline.signal])
        : deadline.signal;
      let exit;
      try {
        exit = await Effect.runPromiseExit(
          discover(work, run).pipe(
            Effect.provideService(DiscoveryServices, {
              repository,
              clock,
              provider,
              authorize: async () => {
                try {
                  await dependencies.queue?.capacity?.authorize(work);
                } catch (error: unknown) {
                  if (error instanceof ApplicationError) throw error;
                  throw new DiscoveryFailure("queue_unavailable");
                }
                return dependencies.authenticateWork(work);
              },
            }),
          ),
          { signal },
        );
      } finally {
        clearTimeout(timer);
      }
      const reason = Exit.isSuccess(exit) ? exit.value : exitReason(exit);
      await repository.finish(work, reason, clock.now());
      if (reason !== "completed" && reason !== "budget_exhausted")
        dependencies.reportFailure?.({
          businessId: work.businessId,
          runId: work.runId,
          code: reason,
        });
      if (reason === "defect") throw new Error("Discovery worker failed");
      return { outcome: reason };
    },
    async stopWorker(
      payload: unknown,
      reason: "worker_lost" | "interrupted" = "worker_lost",
    ) {
      const work = validate(workSchema, payload);
      await repository.finish(work, reason, clock.now());
    },
  };
}
