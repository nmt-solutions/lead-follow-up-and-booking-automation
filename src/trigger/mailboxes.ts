import { AbortTaskRunError, task } from "@trigger.dev/sdk";
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
          )
            return result;
          if (result.reason === "provider_unavailable")
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
