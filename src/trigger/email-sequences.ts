import { AbortTaskRunError, schedules, task } from "@trigger.dev/sdk";
import { ApplicationError } from "../models/application-error";
import { sequenceWorkSchema } from "../models/email-sequences";
import { withEmailSequenceWorker } from "../email-sequences/worker";

export const dispatchApprovedEmailSequence = task({
  id: "dispatch-approved-email-sequence",
  queue: { concurrencyLimit: 4 },
  retry: { maxAttempts: 3 },
  maxDuration: 60,
  run: async (payload: unknown, { signal }) => {
    const parsed = sequenceWorkSchema.safeParse(payload);
    if (!parsed.success)
      throw new AbortTaskRunError("Invalid email sequence work");
    try {
      return await withEmailSequenceWorker((app) =>
        app.execute(parsed.data, signal),
      );
    } catch (error: unknown) {
      if (
        error instanceof ApplicationError &&
        [
          "NOT_FOUND",
          "FORBIDDEN",
          "CONFLICT",
          "UNAUTHENTICATED",
          "MFA_REQUIRED",
        ].includes(error.code)
      ) {
        await withEmailSequenceWorker((app) =>
          app.workerStopped(parsed.data, "authorization_changed"),
        );
        throw new AbortTaskRunError(
          "Sequence authority or scope changed; review saved history",
        );
      }
      throw new Error("Sequence recovery required; inspect persisted history");
    }
  },
  onFailure: async ({ payload }) => {
    if (sequenceWorkSchema.safeParse(payload).success)
      await withEmailSequenceWorker((app) =>
        app.workerStopped(payload, "worker_lost"),
      );
  },
  onCancel: async ({ payload }) => {
    if (sequenceWorkSchema.safeParse(payload).success)
      await withEmailSequenceWorker((app) =>
        app.workerStopped(payload, "worker_lost"),
      );
  },
});
export const recoverApprovedEmailSequences = schedules.task({
  id: "recover-approved-email-sequences",
  cron: process.env.TRIGGER_EMAIL_SEQUENCE_RECOVERY_CRON,
  retry: { maxAttempts: 3 },
  maxDuration: 180,
  run: async () => {
    try {
      return await withEmailSequenceWorker((app) => app.recoverDue());
    } catch {
      throw new Error(
        "Sequence recovery unavailable; inspect queue and saved history",
      );
    }
  },
});
