import { productionCron } from "./cron";
import { capacityDeployment, capacityLimits } from "../discovery/capacity";
import {
  AbortTaskRunError,
  task,
  schedules,
  concurrencyLimit,
} from "@trigger.dev/sdk";
import { withDiscoveryWorker } from "../discovery/worker";
import { scheduleWorkSchema } from "../models/discovery-schedules";
import { workSchema } from "../models/discovery";

const capacity = capacityDeployment(process.env);
// SDK 4.8.3 registers all named partitions during deployment. A named limit
// does not buy compute: the reviewed finite provider allocation is required too.
const limits = capacity
  ? capacityLimits(capacity).map((limit) => concurrencyLimit(limit))
  : [];
export const boundedDiscovery = task({
  id: "bounded-prospect-discovery",
  // Inline TOTAL remains enforced even when trigger-time named limits replace
  // the task's defaults. Every application enqueue supplies global AND lane.
  concurrency: [{ total: capacity?.policy.total ?? 1 }, ...limits.slice(0, 2)],
  // Infrastructure retries re-enter persisted checkpoints under the SAME attempt
  // allowance/deadline. An ambiguous reservation stops; it never repeats a call.
  retry: { maxAttempts: 3 },
  maxDuration: 180,
  run: async (payload: unknown, { signal, ctx }) => {
    const parsed = workSchema.safeParse(payload);
    if (!parsed.success) throw new AbortTaskRunError("Invalid discovery work");
    try {
      return await withDiscoveryWorker(
        (application) =>
          application.execute(parsed.data, {
            signal,
            durable: { runId: ctx.run.id, number: ctx.attempt.number },
          }),
        ctx,
      );
    } catch {
      throw new Error(
        "Discovery worker failed. Inspect the persisted run state.",
      );
    }
  },
  onFailure: async ({ payload }) => {
    if (workSchema.safeParse(payload).success) {
      try {
        await withDiscoveryWorker((application) =>
          application.stopWorker(payload),
        );
      } catch {
        throw new Error("Discovery recovery state could not be recorded");
      }
    }
  },
  onCancel: async ({ payload }) => {
    if (workSchema.safeParse(payload).success) {
      try {
        await withDiscoveryWorker((application) =>
          application.stopWorker(payload, "interrupted"),
        );
      } catch {
        throw new Error("Discovery interruption state could not be recorded");
      }
    }
  },
});

export const scheduledDiscovery = task({
  id: "scheduled-prospect-discovery",
  retry: { maxAttempts: 3 },
  run: async (payload: unknown) => {
    const parsed = scheduleWorkSchema.safeParse(payload);
    if (!parsed.success)
      throw new AbortTaskRunError("Invalid scheduled discovery work");
    try {
      return await withDiscoveryWorker((application) =>
        application.dispatchScheduled(parsed.data),
      );
    } catch {
      throw new Error(
        "Scheduled discovery dispatch failed. Inspect persisted state.",
      );
    }
  },
  onFailure: async ({ payload }) => {
    if (!scheduleWorkSchema.safeParse(payload).success) return;
    try {
      await withDiscoveryWorker((application) =>
        application.stopSchedule(payload),
      );
    } catch {
      throw new Error("Schedule recovery state could not be recorded");
    }
  },
  onCancel: async ({ payload }) => {
    if (!scheduleWorkSchema.safeParse(payload).success) return;
    try {
      await withDiscoveryWorker((application) =>
        application.stopSchedule(payload),
      );
    } catch {
      throw new Error("Schedule interruption state could not be recorded");
    }
  },
});

// Trigger owns the persisted recovery cadence. The application never starts a
// timer/cron process; only pending transactional outbox capabilities are drained.
// No cadence is invented: operator configuration is required before activation.
export const recoverDiscoveryDispatches = schedules.task({
  id: "recover-discovery-dispatches",
  cron: productionCron(process.env.TRIGGER_DISCOVERY_RECOVERY_CRON),
  retry: { maxAttempts: 3 },
  run: async () => {
    try {
      return await withDiscoveryWorker((application) =>
        application.recoverDispatches(),
      );
    } catch {
      throw new Error(
        "Discovery dispatch recovery failed. Inspect persisted state.",
      );
    }
  },
});
