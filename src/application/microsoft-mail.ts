import type { createSessionAccess } from "../auth/access";
import type { createMicrosoftMailGrantService } from "./microsoft-mail-grants";
import {
  createMailboxAuthorizationApplication,
  mailboxAuthorizationContext,
} from "./mailbox-authorization";

export function createMicrosoftMailApplication(options: {
  access: Pick<ReturnType<typeof createSessionAccess>, "authenticateForWork">;
  connection: Pick<
    ReturnType<typeof createMicrosoftMailGrantService>,
    "read" | "start" | "callback" | "disconnect" | "folders"
  >;
  queueInitialSync?(
    credentials: Headers,
    businessId: string,
    mailboxId: string,
  ): Promise<unknown>;
}) {
  return {
    ...createMailboxAuthorizationApplication(options),
    async folders(credentials: Headers, id: unknown, mailboxId: unknown) {
      const c = await mailboxAuthorizationContext(
        options.access,
        credentials,
        id,
        mailboxId,
      );
      return options.connection.folders(c.actor, c.businessId, c.mailboxId);
    },
  };
}
