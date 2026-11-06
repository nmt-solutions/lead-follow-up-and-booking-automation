import { tasks } from "@trigger.dev/sdk";
import type { MailboxWork } from "../models/mailboxes";

/** Wire only alongside a configured native mailbox adapter and deployed worker. */
export function configuredMailboxQueue(environment: NodeJS.ProcessEnv) {
  if (
    !environment.TRIGGER_SECRET_KEY ||
    !environment.TRIGGER_PROJECT_REF ||
    environment.MAILBOX_WORKER_DEPLOYMENT_CONFIRMED !== "true"
  )
    return undefined;
  return async (work: MailboxWork) => {
    // Dispatch can be repeated; PostgreSQL owns cursor compare-and-swap and message deduplication.
    await tasks.trigger("synchronize-selected-mailbox", work);
  };
}
