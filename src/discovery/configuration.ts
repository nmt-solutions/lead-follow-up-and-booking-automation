import { createCapacityDiscoveryQueue, capacityDeployment } from "./capacity";
import type { createDiscoveryCapacityRepository } from "../db/discovery-capacity-repository";
import {
  tasks,
  idempotencyKeys,
  concurrencyLimits,
  queues,
  deployments,
} from "@trigger.dev/sdk";
import type { DiscoveryProvider } from "../models/discovery";
import type { createAiApplication } from "../application/ai";
import { createProfiledDiscoveryProvider } from "../ai/discovery-provider";
import { createExaRetrieval } from "./exa";

export function configuredExaRetrieval(environment: NodeJS.ProcessEnv) {
  let activation: unknown = null;
  try {
    activation = JSON.parse(environment.EXA_ACTIVATION_JSON ?? "null");
  } catch {
    /* Missing setup is public; raw environment values never are. */
  }
  return createExaRetrieval({
    activation,
    apiKey:
      environment.EXA_LIVE_ENABLED === "true"
        ? environment.OPERATOR_EXA_API_KEY
        : undefined,
    fetch,
    clock: { now: () => new Date() },
  });
}
export function configuredDiscoveryProvider(
  ai: Pick<ReturnType<typeof createAiApplication>, "executeWorkflow">,
  retrieval: Pick<
    DiscoveryProvider,
    "id" | "setup" | "search" | "contents"
  > | null = null,
): DiscoveryProvider | null {
  return retrieval ? createProfiledDiscoveryProvider(retrieval, ai) : null;
}
export function configuredDiscoveryQueue(
  environment: NodeJS.ProcessEnv,
  repository: ReturnType<typeof createDiscoveryCapacityRepository>,
  execution?: Parameters<typeof createCapacityDiscoveryQueue>[0]["execution"],
) {
  const deployment = capacityDeployment(environment);
  if (
    !deployment ||
    !environment.TRIGGER_SECRET_KEY ||
    !environment.TRIGGER_PROJECT_REF ||
    !environment.TRIGGER_DISCOVERY_RECOVERY_CRON ||
    environment.DISCOVERY_WORKER_DEPLOYMENT_CONFIRMED !== "true"
  )
    return null;
  return createCapacityDiscoveryQueue({
    deployment,
    repository,
    execution,
    native: {
      key: (value) => idempotencyKeys.create(value, { scope: "global" }),
      deployment: () =>
        deployments.retrieveCurrent({ retry: { maxAttempts: 1 } }),
      queue: () =>
        queues.retrieve(
          { type: "task", name: "bounded-prospect-discovery" },
          { retry: { maxAttempts: 1 } },
        ),
      retrieve: (name) =>
        concurrencyLimits.retrieve(name, { retry: { maxAttempts: 1 } }),
      trigger: (task, work, options) => tasks.trigger(task, work, options),
    },
  });
}
