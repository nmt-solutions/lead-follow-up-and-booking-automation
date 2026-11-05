import { tasks, idempotencyKeys } from "@trigger.dev/sdk";
import type { ScheduleWork } from "../models/discovery-schedules";
import type { DiscoveryProvider, DiscoveryWork } from "../models/discovery";
import type { createAiApplication } from "../application/ai";
import { createProfiledDiscoveryProvider } from "../ai/discovery-provider";

// #16 supplies the selected Exa/AI adapter. No environment flag can accidentally
// activate fixtures, an unsigned contract, another product or a hidden fallback.
export function configuredDiscoveryProvider(
  ai: Pick<ReturnType<typeof createAiApplication>, "executeWorkflow">,
  retrieval: Pick<DiscoveryProvider, "id" | "search"> | null = null,
): DiscoveryProvider | null {
  return retrieval ? createProfiledDiscoveryProvider(retrieval, ai) : null;
}
export function configuredDiscoveryQueue(environment: NodeJS.ProcessEnv) {
  if (
    !environment.TRIGGER_SECRET_KEY ||
    !environment.TRIGGER_PROJECT_REF ||
    !environment.TRIGGER_DISCOVERY_RECOVERY_CRON ||
    environment.DISCOVERY_WORKER_DEPLOYMENT_CONFIRMED !== "true"
  )
    return null;
  return {
    async schedule(work: ScheduleWork) {
      await tasks.trigger("scheduled-prospect-discovery", work, {
        delay: new Date(work.dueAt),
        idempotencyKey: await idempotencyKeys.create(
          `discovery-schedule-${work.scheduleId}-${work.revision}-${work.dueAt}`,
          { scope: "global" },
        ),
      });
    },
    async enqueue(work: DiscoveryWork) {
      await tasks.trigger("bounded-prospect-discovery", work, {
        idempotencyKey: await idempotencyKeys.create(
          `discovery-${work.runId}-${work.executionKey}`,
          { scope: "global" },
        ),
        idempotencyKeyTTL: "30d",
      });
    },
  };
}
