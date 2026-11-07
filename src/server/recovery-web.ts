import "server-only";
import { randomUUID } from "node:crypto";
import {
  configuredRecoveryPlans,
  configuredRecoveryInventories,
  recoveryReadiness,
} from "../recovery/configuration";
import { ApplicationError } from "../models/application-error";
export function configuredRecoveryWeb(env: Record<string, string | undefined>) {
  let plans: ReturnType<typeof configuredRecoveryPlans> = [],
    inventories: ReturnType<typeof configuredRecoveryInventories> = [];
  const setupIssues: string[] = [];
  try {
    plans = configuredRecoveryPlans(env);
    inventories = configuredRecoveryInventories(env);
  } catch {
    setupIssues.push(
      "The approved recovery registry or inventory is invalid. Ask its owner to verify the immutable registry hash and exact environment evidence.",
    );
    plans = [];
    inventories = [];
  }
  return {
    plans,
    setupIssues,
    readiness: () => recoveryReadiness(plans, inventories, env, new Date()),
    queue: env.TRIGGER_RECOVERY_SECRET_KEY
      ? {
          async enqueue(operationId: string) {
            try {
              const { tasks, auth } = await import("@trigger.dev/sdk");
              await auth.withAuth(
                {
                  accessToken: env.TRIGGER_RECOVERY_SECRET_KEY,
                  baseURL: "https://api.trigger.dev",
                },
                () =>
                  tasks.trigger(
                    "recover-isolated-business",
                    { operationId },
                    {
                      region: "us-east-1",
                      idempotencyKey: `infrastructure/${operationId}/${randomUUID()}`,
                      queue: "infrastructure-recovery",
                    },
                  ),
              );
            } catch {
              throw new ApplicationError("PROVIDER_UNAVAILABLE");
            }
          },
        }
      : undefined,
  };
}
