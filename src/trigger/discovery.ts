import { AbortTaskRunError, task } from "@trigger.dev/sdk";
import { withDiscoveryWorker } from "../discovery/worker";
import { workSchema } from "../models/discovery";

export const boundedDiscovery = task({
  id: "bounded-prospect-discovery",
  queue: { concurrencyLimit: 4 },
  // No host/SDK retry may repeat a potentially accepted billable operation.
  // Persisted queued work can be redelivered; a claimed run never reissues calls.
  retry: { maxAttempts: 1 },
  maxDuration: 180,
  run: async (payload: unknown, { signal }) => {
    const parsed = workSchema.safeParse(payload);
    if (!parsed.success) throw new AbortTaskRunError("Invalid discovery work");
    try {
      return await withDiscoveryWorker((application) =>
        application.execute(parsed.data, { signal }),
      );
    } catch {
      throw new AbortTaskRunError(
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
