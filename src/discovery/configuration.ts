import { tasks } from "@trigger.dev/sdk";
import type { DiscoveryProvider, DiscoveryWork } from "../models/discovery";

// #16 supplies the selected Exa/AI adapter. No environment flag can accidentally
// activate fixtures, an unsigned contract, another product or a hidden fallback.
export function configuredDiscoveryProvider(): DiscoveryProvider | null {
  return null;
}
export function configuredDiscoveryQueue(environment: NodeJS.ProcessEnv) {
  if (!environment.TRIGGER_SECRET_KEY || !environment.TRIGGER_PROJECT_REF)
    return null;
  return {
    async enqueue(work: DiscoveryWork) {
      await tasks.trigger("bounded-prospect-discovery", work, {
        idempotencyKey: `discovery-${work.runId}-${work.executionKey}`,
        idempotencyKeyTTL: "30d",
      });
    },
  };
}
