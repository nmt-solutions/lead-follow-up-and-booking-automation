import { schedules, task } from "@trigger.dev/sdk";
import { recoverIsolatedBusiness } from "../recovery/worker";
export const isolatedBusinessRecovery = task({
  id: "recover-isolated-business",
  queue: { name: "infrastructure-recovery", concurrencyLimit: 1 },
  maxDuration: 1800,
  retry: { maxAttempts: 3 },
  run: async (payload: unknown, { ctx }) => {
    try {
      return await recoverIsolatedBusiness(payload, {
        project: ctx.project.ref,
        environment: ctx.environment.slug,
        worker: ctx.deployment?.id ?? "unobserved",
        region: ctx.run.region ?? null,
        runId: ctx.run.id,
      });
    } catch {
      throw new Error(
        "Isolated recovery remains incomplete. Inspect the original operation and current authorization.",
      );
    }
  },
});
export const infrastructureRecoveryMaintenance = schedules.task({
  id: "recover-pending-isolated-businesses",
  cron: process.env.TRIGGER_INFRASTRUCTURE_RECOVERY_CRON,
  retry: { maxAttempts: 3 },
  run: async (_payload, { ctx }) => {
    try {
      return await recoverIsolatedBusiness(
        {},
        {
          project: ctx.project.ref,
          environment: ctx.environment.slug,
          worker: ctx.deployment?.id ?? "unobserved",
          region: ctx.run.region ?? null,
          runId: ctx.run.id,
        },
      );
    } catch {
      throw new Error(
        "Pending isolated recovery requires current authorized review.",
      );
    }
  },
});
