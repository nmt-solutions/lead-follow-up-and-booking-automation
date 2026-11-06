import { runs, tasks } from "@trigger.dev/sdk";
import type { SequenceQueue } from "../models/email-sequences";

export function configuredSequenceQueue(
  environment: NodeJS.ProcessEnv,
): SequenceQueue | undefined {
  if (
    !environment.TRIGGER_SECRET_KEY ||
    !environment.TRIGGER_PROJECT_REF ||
    environment.EMAIL_SEQUENCE_WORKER_DEPLOYMENT_CONFIRMED !== "true" ||
    !environment.TRIGGER_EMAIL_SEQUENCE_RECOVERY_CRON
  )
    return undefined;
  return {
    async enqueue(work, dueAt) {
      const run = await tasks.trigger(
        "dispatch-approved-email-sequence",
        work,
        {
          delay: dueAt,
          idempotencyKey: `email-sequence:${work.actionId}:${work.generation}`,
          idempotencyKeyTTL: "7d",
        },
      );
      return run.id;
    },
    async cancel(id) {
      await runs.cancel(id);
    },
  };
}
