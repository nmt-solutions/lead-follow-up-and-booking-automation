import { Cause, Effect, Exit } from "effect";
import { businessIdSchema, type Actor, type Clock } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  startDiscoverySchema,
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
  queue: { enqueue(work: DiscoveryWork): Promise<void> } | null;
  reportFailure?(diagnostic: {
    businessId: string;
    runId: string;
    code: StopReason;
  }): void;
}) {
  const { repository, clock } = dependencies;
  async function workspace(credentials: Credentials, id: unknown) {
    const actor = await dependencies.authenticate(credentials);
    const state = await repository.workspace(
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
    return state;
  }
  return {
    workspace,
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
      const exit = await Effect.runPromiseExit(
        owned(() => repository.create(actor, businessId, request, clock.now())),
      );
      if (Exit.isFailure(exit)) {
        const failure = Cause.findErrorOption(exit.cause);
        if (failure._tag === "Some") throw failure.value;
        throw new Error("Discovery creation failed");
      }
      const { run, work } = exit.value;
      if (run.status === "queued") {
        try {
          await dependencies.queue.enqueue(work);
        } catch {
          await repository.finish(work, "queue_unavailable", clock.now());
          throw new ApplicationError("PROVIDER_UNAVAILABLE");
        }
      }
      return { id: run.id, status: run.status };
    },
    async execute(payload: unknown, options: { signal?: AbortSignal } = {}) {
      const work = validate(workSchema, payload);
      let run;
      try {
        await dependencies.authenticateWork(work);
        run = await repository.claim(work, clock.now());
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
      if (!provider || provider.id !== run.policy.adapterId) {
        await repository.finish(work, "configuration_changed", clock.now());
        return { outcome: "configuration_changed" };
      }
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), run.policy.deadlineMs);
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
              authorize: () => dependencies.authenticateWork(work),
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
