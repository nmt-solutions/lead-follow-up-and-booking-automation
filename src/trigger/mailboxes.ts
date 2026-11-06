import { AbortTaskRunError, task, tasks } from "@trigger.dev/sdk";
import { mailboxWorkSchema } from "../models/mailboxes";
import { ApplicationError } from "../models/application-error";
import { withMailboxWorker } from "../mailboxes/worker";

export const synchronizeMailbox = task({
  id: "synchronize-selected-mailbox",
  queue: { concurrencyLimit: 4 },
  retry: { maxAttempts: 3 },
  maxDuration: 180,
  run: async (payload: unknown, { signal }) => {
    const parsed = mailboxWorkSchema.safeParse(payload);
    if (!parsed.success) throw new AbortTaskRunError("Invalid mailbox work");
    try {
      return await withMailboxWorker(async (app) => {
        for (let page = 0; page < 50; page++) {
          const result = await app.execute(parsed.data, signal);
          if (
            !result ||
            result.status === "completed" ||
            result.status === "blocked" ||
            result.reason === "limit_reached"
          ) {
            if (
              (!result || result.status === "completed") &&
              process.env.MAILBOX_WORKER_DEPLOYMENT_CONFIRMED === "true"
            )
              await tasks.trigger("poll-selected-mailbox", parsed.data, {
                delay: "60s",
                idempotencyKey: `mailbox-poll:${parsed.data.jobId}`,
                idempotencyKeyTTL: "7d",
              });
            return result;
          }
          if (result.reason === "rate_limited" && result.retryAt) {
            await tasks.trigger("synchronize-selected-mailbox", parsed.data, {
              delay: new Date(result.retryAt),
              idempotencyKey: `mailbox-throttle:${result.id}:${result.retryAt}`,
              idempotencyKeyTTL: "7d",
            });
            return result;
          }
          if (
            result.reason === "provider_unavailable" ||
            result.reason === "rate_limited"
          )
            throw new Error("Mailbox provider unavailable");
        }
        // Trigger retry resumes the persisted checkpoint and the same import allowance.
        throw new Error("Mailbox continuation required");
      });
    } catch (error: unknown) {
      if (
        error instanceof ApplicationError &&
        [
          "CONFLICT",
          "FORBIDDEN",
          "NOT_FOUND",
          "UNAUTHENTICATED",
          "MFA_REQUIRED",
        ].includes(error.code)
      )
        throw new AbortTaskRunError(
          "Mailbox authority or scope changed; review saved setup",
        );
      throw new Error(
        "Mailbox sync stopped; review the persisted import state",
      );
    }
  },
});

/** Trigger owns the delayed continuation. No web-process timer, public push endpoint or worker activation. */
export const pollSelectedMailbox = task({
  id: "poll-selected-mailbox",
  queue: { concurrencyLimit: 4 },
  retry: { maxAttempts: 3 },
  maxDuration: 60,
  run: async (payload: unknown) => {
    const parsed = mailboxWorkSchema.safeParse(payload);
    if (!parsed.success)
      throw new AbortTaskRunError("Invalid mailbox continuation");
    try {
      return await withMailboxWorker(async (app) => {
        const next = await app.repeat(parsed.data);
        if (next)
          await tasks.trigger("synchronize-selected-mailbox", next, {
            idempotencyKey: `mailbox-sync:${next.jobId}`,
            idempotencyKeyTTL: "7d",
          });
        return { queued: Boolean(next) };
      });
    } catch (error) {
      if (error instanceof ApplicationError)
        throw new AbortTaskRunError(
          "Mailbox permission or session changed; review synchronization",
        );
      throw new Error(
        "Mailbox continuation unavailable; resume saved synchronization",
      );
    }
  },
});

/** Preserve already queued #29 task IDs across deployment; authority is checked by the shared continuation. */
export const pollSelectedGmail = task({
  id: "poll-selected-gmail",
  retry: { maxAttempts: 3 },
  run: async (payload: unknown) => {
    const parsed = mailboxWorkSchema.safeParse(payload);
    if (!parsed.success)
      throw new AbortTaskRunError("Invalid mailbox continuation");
    await tasks.trigger("poll-selected-mailbox", parsed.data, {
      idempotencyKey: `mailbox-poll:${parsed.data.jobId}`,
      idempotencyKeyTTL: "7d",
    });
    return { queued: true };
  },
});
